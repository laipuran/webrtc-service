# ADR-0001 — 信令消息协议

- **状态**：已接受
- **日期**：2026-08-26
- **背景**：WebRTC 信令服务器通过 WebSocket 交换控制消息。信令是 CS 架构，客户端与服务器节点不对等，消息天然分"请求"与"响应/通知"两种方向。为避免把两个方向塞进同一个平铺枚举导致方向混淆（例如 `Leave` 既当客户端请求又当服务器通知），消息按发送方分为两层：`ClientMsg`（客户端 → 服务器，请求）与 `ServerMsg`（服务器 → 客户端，响应/事件）。

## 决策

信令消息按发送方分为两个 serde 枚举，各自带内部标签（`type` 字段）：

```rust
type PeerId = u64;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
struct Member {
    peer_id: PeerId,
    username: String,
}

// 客户端 → 服务器（请求）
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    Join { room_id: String, auth: String, username: String },
    Leave,                                  // 主动离开的请求
}

// 服务器 → 客户端（响应 / 事件）
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerMsg {
    Joined   { peer_id: PeerId, room_id: String }, // Join 的响应，仅发给请求者
    Roster   { members: Vec<Member> },       // 广播事件（含新人）
    PeerLeft { peer_id: PeerId },            // 事件：某人已离开
    Error    { message: String },            // 失败响应 / 通知
}
```

- 使用 `#[serde(tag = "type")]`：`type` 字段自动把读取的 JSON 分派到对应变体，无需手写 if/else 判断。
- `PeerId` 为 `u64`，由服务器在连接时分配，用于路由，不以 username 作为路由键。
- peer id 仅在单个房间内唯一，不同房间可复用。

## 各消息职责

### ClientMsg（客户端 → 服务器）

| 变体 | 字段 | 说明 |
|------|------|------|
| `Join` | `room_id`, `auth`, `username` | 请求进入房间 |
| `Leave` | — | 主动离开请求，服务器已知该连接的 peer，无需带字段 |

### ServerMsg（服务器 → 客户端）

| 变体 | 字段 | 方向 | 说明 |
|------|------|------|------|
| `Joined` | `peer_id`, `room_id` | 单播给请求者 | 对 `Join` 的响应，告知被分配的 peer id |
| `Roster` | `members` | 广播全员（含新人） | 当前成员（id + 显示名） |
| `PeerLeft` | `peer_id` | 广播给房间内其余成员 | 通知某人已离开 |
| `Error` | `message` | — | auth 认证失败等回信 / 通知 |

## 关键取舍

### 双层按方向分类
信令是 CS 架构，客户端与服务器不对等。方向由类型本身决定（`ClientMsg` / `ServerMsg`），而非在消息内用字段标识。这消除了"一条 `Leave` 既是请求又是通知"的混淆，也避免了混淆导致的串号（把响应当请求处理）。

### `Leave` 为显式请求，断线检测仅作兜底
客户端主动离开 = 发送 `ClientMsg::Leave`，服务器移除后广播 `ServerMsg::PeerLeft`。客户端崩溃 / 断网 / 进程被杀时无法发出 `Leave`，故服务器仍需在 WebSocket 读循环检测断开（`next()` 返回 `None`/`Err` 时触发清理）。两种路径（显式 `Leave` 与断线检测）收敛到服务器同一"移除 + 广播 `PeerLeft`"逻辑。

### `auth` 为房间密钥，由创建房间的人设定
服务器维护 `room_id → key` 映射。首个进入某房间的人创建该房间并设定 `auth`；之后的 `Join` 用同一 `auth` 校验，失败时回 `ServerMsg::Error`。

### `members` 带 `username`
`roster.members` 是 `Member { peer_id, username }` 对象数组，而非纯 id 数组。原因：`username` 是显示名，客户端需要一次拿到"谁在房里 + 显示名"，避免为每个成员另行请求。

### username 不参与路由
路由只依赖 `PeerId`。`username` 仅用于 roster 展示；WebRTC 建连（SDP / ICE 候选交换）也与 id、username 无关，前者靠 SDP/ICE，后者靠信令层按 `PeerId` 送达。

### 单独引入 `Error`
由于存在 `auth` 校验，认证失败必然需要一条服务器对客户端的失败回信，故补充独立的 `Error` 变体兜底。

## 影响 / 后续

- Ticket 03 将同时在 `ClientMsg` 和 `ServerMsg` 内扩展 `Offer` / `Answer` / `IceCandidate` 变体，复用同一 `PeerId` 概念。
- 若后续引入账号系统，`Join` 中的 `auth` / `username` 字段可能变化，届时本 ADR 需修订。
- 新增消息变体时，在对应方向的枚举内扩展即可，无需改动分派逻辑。
