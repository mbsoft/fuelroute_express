class MinHeap {
  constructor() {
    this.heap = [];
  }

  push(item) {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  get size() {
    return this.heap.length;
  }

  _siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent][0] <= this.heap[i][0]) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _siftDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left][0] < this.heap[smallest][0]) smallest = left;
      if (right < n && this.heap[right][0] < this.heap[smallest][0]) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

/**
 * Dijkstra's shortest path algorithm.
 * @param {Map<number, Array<{to: number, weight: number, fuel: number}>>} adjacency
 * @param {number} source
 * @param {number} target
 * @param {number} numNodes
 * @returns {{ path: number[], cost: number } | null}
 */
function dijkstra(adjacency, source, target, numNodes) {
  const dist = new Array(numNodes).fill(Infinity);
  const prev = new Array(numNodes).fill(-1);
  dist[source] = 0;

  const pq = new MinHeap();
  pq.push([0, source]);

  while (pq.size > 0) {
    const [d, u] = pq.pop();
    if (d > dist[u]) continue;
    if (u === target) break;

    for (const edge of adjacency.get(u) || []) {
      const alt = dist[u] + edge.weight;
      if (alt < dist[edge.to]) {
        dist[edge.to] = alt;
        prev[edge.to] = u;
        pq.push([alt, edge.to]);
      }
    }
  }

  if (dist[target] === Infinity) return null;

  const path = [];
  for (let at = target; at !== -1; at = prev[at]) path.push(at);
  path.reverse();
  return { path, cost: dist[target] };
}

module.exports = { dijkstra };
