假设NFD有N个接口（Face），给定目标节点D，路由决策的数学描述为：

$$\text{选择} \; Face_i \; \text{使得} \; Cost(Face_i 
\rightarrow D) = \min_{j=1}^{N} Cost(Face_j 
\rightarrow D)$$

其中，$Cost(Face_i 
\rightarrow D)$表示从接口i到目标D的传输成本。

## 1.2 经典方法：Dijkstra算法

传统上，解决上述优化问题的标准方法是使用Dijkstra算法。该算法基于图论，以系统化的方式找出从一个节点到其他所有节点的最短路径。
