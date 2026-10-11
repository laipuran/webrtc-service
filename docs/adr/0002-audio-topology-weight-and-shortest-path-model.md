# ADR-0002 — 音频拓扑规划器的权重与最短路径模型

- **状态**：已接受，待实现（2026-10-02）
- **日期**：2026-10-02
- **背景**：当前 WebRTC 客户端使用房间内全 Mesh 连接，每个成员直接与其他成员交换音频。后续需要让部分成员承担音频转发，并根据成员之间的链路延迟计算更合适的传输拓扑。第一阶段只实现后端的纯内存拓扑规划器，不接入 WebRTC、信令消息或实时指标采集。

## 决策

拓扑规划器将房间成员建模为有向加权图。图的节点是 `MemberId`，有向边表示一个成员向另一个成员发送音频时可用的链路，边权表示该方向的路径代价。

第一阶段默认每个成员的音频都需要到达其他成员。规划器为每个成员分别计算一棵有向最短路径树，而不是为整个房间计算一棵单根树或最小生成树。

权重通过 trait 抽象，具体指标与路径算法分离：

```rust
pub trait Weight: Copy + Ord {
    fn zero() -> Self;
    fn checked_add(self, rhs: Self) -> Option<Self>;
}
```

第一阶段使用延迟权重：

```rust
pub struct LatencyWeight(u64); // milliseconds
```

未来如果加入 jitter、丢包率、带宽或中继负载，应通过独立的权重模型将原始指标聚合为一个实现了 `Weight` 的最终边权，而不是修改 Dijkstra。

## 领域对象的设计意图

### `Weight`

`Weight` 表示已经可以用于最短路径计算的路径代价，不表示某一种具体网络指标。

- `zero()` 表示尚未经过任何边的路径代价，即源节点到自身的代价。
- `checked_add()` 用于累加路径上的边权；溢出时返回 `None`，避免产生错误的路径代价。
- `Ord` 用于比较候选路径，并支持 Dijkstra 的优先队列。
- 使用整数而不是浮点数，保证路径代价具有稳定的全序。

`Weight` 不负责了解延迟、丢包或 jitter 的业务含义，也不负责采集网络指标。

### `LatencyWeight`

`LatencyWeight` 是第一阶段的具体权重类型，单位为毫秒。

其字段保持私有，通过构造函数和读取方法访问，以避免调用方绕过单位约定直接构造内部值。它派生排序、相等和复制能力，并实现 `Weight`。

选择毫秒的原因是第一阶段只需要验证拓扑算法，不需要区分非常小的亚毫秒差异。未来如果测量精度和优化目标发生变化，可以替换内部单位，而不修改图算法的接口。

### `WeightModel`

原始链路指标和最终路径权重之间保留独立的转换 seam。未来可以采用类似下面的抽象：

```rust
pub trait WeightModel<Metric> {
    type Weight: Weight;

    fn weight(&self, metric: &Metric) -> Option<Self::Weight>;
}
```

例如：

- `LatencyModel`：只根据延迟生成 `LatencyWeight`；
- `CompositeModel`：将延迟、jitter、丢包和负载归一化后聚合为综合权重。

第一阶段的 Dijkstra 直接接收已经构造好的 `Weight`，暂不实现实时 `Metric` 或 `WeightModel`。

### `DirectedGraph`

`DirectedGraph<W>` 表示房间成员之间的有向加权图。

- 节点使用已有的 `MemberId`；
- 图创建时一次性注册成员；
- 图内部可以为成员分配私有的 `NodeIndex(usize)`，供数组和优先队列使用；
- 外部接口不暴露节点索引，仍使用 `MemberId`；
- `A -> B` 不会自动产生 `B -> A`；
- 自环 `A -> A` 非法；
- 未注册成员不能添加边；
- 同一方向的重复边保留权重较小的一条；
- 缺失边表示该方向不可用，不使用默认权重补全。

使用内部 `NodeIndex` 是为了避免要求 `MemberId` 实现算法所需的排序能力，同时让领域标识和算法索引保持分离。

### `SourceTree`

`SourceTree<W>` 表示某一个音频源到房间其他成员的最短路径树。

逻辑上包含：

```text
source       音频源成员
parents      每个目标成员的上游成员
distances    源到每个成员的最短路径代价
```

其中 `parents` 是树的规范表示：

```text
parent(B) = A
parent(C) = B
parent(D) = A
```

这表示音频转发关系：

```text
A -> B
B -> C
A -> D
```

子节点不作为另一份独立状态长期维护，而是由 `parents` 派生：

```text
children(A) = [B, D]
children(B) = [C]
```

这样可以避免父节点和子节点两份数据发生不一致。父节点关系适合 Dijkstra 的前驱结果，子节点关系适合未来的音频转发执行。

### `TopologyPlan`

`TopologyPlan` 包含每个成员作为音频源时生成的 `SourceTree`：

```text
trees[source_member_id] = source_tree
```

例如房间中有 `A`、`B`、`C` 三个成员，计划必须包含：

```text
tree(A)
tree(B)
tree(C)
```

第一阶段要求所有源都能到达所有其他成员。任何一个源存在不可达成员时，整个计划无效，不发布部分可用计划。

## Dijkstra 的运行约定

Dijkstra 的候选队列逻辑上保存：

```text
(candidate_distance, node)
```

其中 `candidate_distance` 是源到节点的当前候选总代价，不是单条边的权重。

算法约定如下：

1. 源节点距离初始化为 `Weight::zero()`；
2. 其他节点初始为未知距离，而不是人为定义的无限大；
3. 从当前节点向外松弛有向边；
4. 松弛成功时设置 `parent[destination] = current`；
5. 计算新路径代价时使用 `checked_add()`；
6. 优先队列中的过期条目必须跳过；
7. 所有成员不可达时返回明确错误，不自动补充直连。

父节点在松弛成功时产生，而不是在节点从优先队列弹出时产生。这样可以正确处理同一个节点先后发现多条候选路径的情况。

## 错误语义

拓扑模块至少需要表达以下错误：

| 错误 | 含义 |
|------|------|
| `DuplicateMember` | 图初始化时重复注册成员 |
| `UnknownMember` | 添加边时使用了未注册成员 |
| `SelfLoop` | 添加了 `A -> A` |
| `WeightOverflow` | 路径权重累加发生整数溢出 |
| `UnreachableMembers` | 某个音频源无法到达一个或多个成员 |
| `InvalidTopology` | 输入无法生成完整拓扑计划 |

拓扑规划接口使用 `Result<TopologyPlan, TopologyError>`。不可达错误中应包含：

- 无法完成广播的音频源；
- 对该源不可达的成员列表。

## 为什么不使用 MST

最小生成树优化的是选中边的权重总和，而且通常要求无向图。它不能保证每个音频源到每个接收成员的端到端路径最短。

当前目标是让每个成员的音频都能低延迟地到达其他成员，因此需要针对每个音频源计算最短路径树。

MST 未来最多可以作为中心节点骨干连接的候选算法，但不是第一阶段的房间音频拓扑算法。

## 为什么不是一棵单根最短路径树

单根最短路径树只优化一个源到其他成员的路径。多人通话中每个成员都可能产生音频，所以需要为每个成员分别计算一棵源树。

未来如果只广播当前发言者，可以只计算当前发言者对应的源树；但这不改变第一阶段的多源模型。

## 实现边界

第一阶段允许新增以下模块：

```text
backend/src/topology.rs
backend/src/topology/weight.rs
backend/src/topology/graph.rs
backend/src/topology/dijkstra.rs
backend/src/topology/tree.rs
```

第一阶段不修改：

- `backend/src/message.rs`；
- `backend/src/room/mod.rs`；
- `backend/src/handler.rs`；
- `frontend/` 下的任何文件。

拓扑规划器先使用人工构造的有向图测试。真实 WebRTC stats、指标上报和房间生命周期集成属于后续决策。

## 验收标准

- `LatencyWeight` 可以比较和安全累加；
- 图正确区分有向边；
- 重复边保留最小权重；
- Dijkstra 能选择更低总代价的间接路径；
- Dijkstra 能返回父节点关系；
- `SourceTree` 能由父节点关系派生子节点和完整路径；
- 每个成员都能生成一棵源树；
- 任一源存在不可达成员时，整体规划失败；
- 所有拓扑模块测试通过；
- 算法不依赖 WebRTC、WebSocket 或实时网络状态。

## 后续影响

- 规划器的计算复杂度约为对每个成员运行一次 Dijkstra，即多源场景下重复执行单源最短路径；当前房间规模较小，可以接受；
- 第一阶段的最短路径只考虑延迟，可能选择上传能力不足的成员作为中继；
- 后续加入容量约束时，需要扩展 `LinkMetric`、`WeightModel` 和拓扑约束，而不应把网络采集逻辑放进 Dijkstra；
- 后续媒体执行阶段需要将 `SourceTree` 转换为成员的上游、下游和音频转发规则；
- 保留现有直连作为备用路径属于后续媒体执行策略，不属于本 ADR 的第一阶段算法。
