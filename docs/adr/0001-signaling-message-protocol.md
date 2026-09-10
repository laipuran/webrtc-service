# ADR-0001 — 信令消息协议

- **状态**：已接受（2026-09-10 修订）
- **日期**：初版 2026-08-26；修订 2026-09-10
- **背景**：WebRTC 信令服务器通过 WebSocket 交换控制消息。信令是 CS 架构，客户端与服务器节点不对等，消息天然分"请求"与"响应/事件"两个方向。为避免把两个方向塞进同一个平铺枚举导致方向混淆（例如 `Leave` 既当客户端请求又当服务器通知），消息按发送方分为两层：`ClientMessage`（客户端 → 服务器，请求）与 `ServerMessage`（服务器 → 客户端，响应/事件）。成员与房间使用类型化 ID；投递在产生处显式区分"单播 / 广播"。

## 决策

信令消息按发送方分为两个 serde 枚举，各自带内部标签（`type` 字段）；`Signal` 亦为带标签的枚举；名单条目为普通结构体。ID 为类型化 newtype。

```rust
// 类型化 ID（room/id.rs, room/member.rs）
pub struct RoomId(String);          // 线上为普通字符串
pub struct MemberId(uuid::Uuid);    // uuid v7；线上为 UUID 字符串

// 信令载荷
#[serde(tag = "type")]
enum Signal {
    Offer { sdp: String },
    Answer { sdp: String },
    IceCandidate { candidate: String },
}

// 名单条目（普通结构体，不带 type 标签）
struct MemberSummary {
    member_id: MemberId,
    username: String,
}

// 客户端 → 服务器（请求）
#[serde(tag = "type")]
enum ClientMessage {
    Join { room_id: RoomId, auth: String, username: String },
    Leave,                                       // 无字段：服务器从连接解析当前房间
    Signal { to: MemberId, signal: Signal },
}

// 服务器 → 客户端（响应 / 事件）
#[serde(tag = "type")]
enum ServerMessage {
    Joined     { member_id: MemberId, room_id: RoomId }, // Join 响应，单播给请求者
    Roster     { members: Vec<MemberSummary> },          // 广播（含新人）
    MemberLeft { member_id: MemberId },                  // 广播
    Error      { message: String },                      // 单播
    Signal     { from: MemberId, signal: Signal },       // 目标单播
}
```

- 使用 `#[serde(tag = "type")]`：`type` 字段自动把读取的 JSON 分派到对应变体，无需手写 if/else 判断。
- `RoomId` / `MemberId` 均为 newtype，serde 透明为字符串；`MemberId` 在连接建立时由服务器用 uuid v7 生成，用于路由，不以 username 作为路由键。
- `MemberId` 全局唯一（uuid v7），不依赖房间内分配计数器。

## 各消息职责

### ClientMessage（客户端 → 服务器）

| 变体 | 字段 | 说明 |
|------|------|------|
| `Join` | `room_id`, `auth`, `username` | 请求进入房间 |
| `Leave` | — | 主动离开请求，服务器已知该连接的房间，无需带字段 |
| `Signal` | `to`, `signal` | 请求把信令转发给房间内的目标成员 |

### ServerMessage（服务器 → 客户端）

| 变体 | 字段 | 方向 | 说明 |
|------|------|------|------|
| `Joined` | `member_id`, `room_id` | 单播给请求者 | 对 `Join` 的响应，告知被分配的 member id |
| `Roster` | `members` | 广播全员（含新人） | 当前成员（id + 显示名） |
| `MemberLeft` | `member_id` | 广播 | 通知某人已离开 |
| `Error` | `message` | 单播 | 认证失败、重复加入、目标不存在等回信 |
| `Signal` | `from`, `signal` | 单播给 `to` | 转发某成员的 SDP / ICE 信令 |

## 投递模型

- `Joined`：单播给请求者。
- `Roster`：广播房间全员，新加入者也在其中。
- `MemberLeft`：广播房间全员。
- `Signal`：按 `to` 单播给目标成员；目标不在房间时回 `Error`。
- `Error`：单播给触发的连接。

成员各自持有出站通道，因此房间可直接向成员投递，无需全局路由表。

## 关键取舍

### 双层按方向分类
信令是 CS 架构，客户端与服务器不对等。方向由类型本身决定（`ClientMessage` / `ServerMessage`），而非在消息内用字段标识。这消除了"一条 `Leave` 既是请求又是通知"的混淆，也避免了混淆导致的串号（把响应当请求处理）。

### 类型化 ID
`RoomId` 与 `MemberId` 是各自独立的 newtype，防止把房间 ID 当成员 ID 传递。`MemberId` 采用 uuid v7：全局唯一、无需共享计数器、跨进程/持久化不冲突，且按时间有序。路由只依赖 `MemberId`。

### 投递按单播 / 广播显式区分
每条服务器消息的目标在产生处确定：`Joined` / `Error` / `Signal` 走单播，`Roster` / `MemberLeft` 走广播。

### `Leave` 为显式请求，断线检测仅作兜底
客户端主动离开 = 发送 `ClientMessage::Leave`，服务器移除后广播 `ServerMessage::MemberLeft`。客户端崩溃 / 断网 / 进程被杀时无法发出 `Leave`，故服务器仍在连接关闭回调中触发同一清理。两种路径（显式 `Leave` 与断线）收敛到同一"移除 + 广播 `MemberLeft`"逻辑。

### `auth` 为房间密钥，由首个进入者设定
`Room` 的 `auth` 初始为空；首个 `Join` 设定该房间的 `auth`，之后的 `Join` 用同一 `auth` 校验，失败时回 `ServerMessage::Error`。房间成员清空后自动移除。

### `Roster` 带 `username`
`Roster.members` 是 `MemberSummary { member_id, username }` 对象数组，而非纯 id 数组。原因：`username` 是显示名，客户端需要一次拿到"谁在房里 + 显示名"，避免为每个成员另行请求。

### username 不参与路由
路由只依赖 `MemberId`。`username` 仅用于 roster 展示；WebRTC 建连（SDP / ICE 候选交换）也与 id、username 无关，前者靠 SDP/ICE，后者靠信令层按 `MemberId` 送达。

### 单独引入 `Error`
认证失败、重复加入、信令目标不存在等都需要服务器对客户端的失败回信，故补充独立的 `Error` 变体兜底。

## 错误变体

`RoomError`（`room/result.rs`，基于 `thiserror`）：

| 变体 | 文案 | 触发 |
|------|------|------|
| `AuthFailed` | "Room auth failed" | `Join` 的 `auth` 与房间密钥不符 |
| `JoinedTwice` | "Already joined a room" | 连接已在房间内再次 `Join` |
| `MemberNotExists` | "Member not in room" | `Leave` / `Signal` 的目标不在房间 |

> 早期设计的 `RoomNotExists` 在当前代码路径中不可达（`Join` 自动建房；房间缺失时静默忽略），不属于当前错误集。

## 影响 / 后续

- 若后续引入账号系统，`Join` 中的 `auth` / `username` 字段可能变化，届时本 ADR 需修订。
- 新增消息变体时，在对应方向的枚举内扩展即可，无需改动分派逻辑；新增信令类型时扩展 `Signal`。
