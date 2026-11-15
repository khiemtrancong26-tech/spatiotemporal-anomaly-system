import { createRng } from '../utils/random.js';

/**
 * Isolation Forest (Liu, Ting, Zhou - 2008) cài đặt thuần TypeScript.
 * Không phụ thuộc Node/DOM nên chạy được ở Server (và Worker nếu sau này cần).
 *
 * Mỗi cây là mảng phẳng các node:
 *  - node trong: [featureIndex, splitValue, leftIndex, rightIndex]
 *  - node lá:    [-1, sampleSize, 0, 0]
 */
export type TreeNode = [feature: number, value: number, left: number, right: number];
export type Tree = TreeNode[];

export interface IsolationForest {
  /** Kích thước mẫu con dùng để dựng mỗi cây. */
  psi: number;
  nFeatures: number;
  trees: Tree[];
}

export interface IsolationForestOptions {
  nTrees?: number;
  sampleSize?: number;
  seed?: number;
}

const EULER_GAMMA = 0.5772156649015329;

/** c(n): độ dài đường đi trung bình của tìm kiếm không thành công trong BST. */
export function avgPathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER_GAMMA) - (2 * (n - 1)) / n;
}

function buildTree(data: readonly number[][], ids: number[], maxDepth: number, rng: () => number): Tree {
  const nodes: Tree = [];
  const nFeatures = data[0]!.length;

  const build = (idx: number[], depth: number): number => {
    const me = nodes.length;
    nodes.push([-1, idx.length, 0, 0]);
    if (depth >= maxDepth || idx.length <= 1) return me;

    // Thử các feature theo thứ tự ngẫu nhiên cho tới khi tách được.
    const order = Array.from({ length: nFeatures }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const f of order) {
      let min = Infinity;
      let max = -Infinity;
      for (const id of idx) {
        const v = data[id]![f]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!(max > min)) continue;
      const split = min + rng() * (max - min);
      const left: number[] = [];
      const right: number[] = [];
      for (const id of idx) (data[id]![f]! < split ? left : right).push(id);
      if (left.length === 0 || right.length === 0) continue;
      const l = build(left, depth + 1);
      const r = build(right, depth + 1);
      nodes[me] = [f, split, l, r];
      return me;
    }
    return me; // không tách được -> lá
  };

  build(ids, 0);
  return nodes;
}

export function trainIsolationForest(
  data: readonly number[][],
  options: IsolationForestOptions = {},
): IsolationForest {
  if (data.length < 2) throw new Error('Isolation Forest cần ít nhất 2 mẫu');
  const nTrees = options.nTrees ?? 100;
  const psi = Math.min(options.sampleSize ?? 256, data.length);
  const rng = createRng(options.seed ?? 42);
  const maxDepth = Math.ceil(Math.log2(psi));

  const perm = Array.from({ length: data.length }, (_, i) => i);
  const trees: Tree[] = [];
  for (let t = 0; t < nTrees; t++) {
    // Fisher-Yates từng phần: lấy psi phần tử đầu làm mẫu không hoàn lại.
    for (let i = 0; i < psi; i++) {
      const j = i + Math.floor(rng() * (perm.length - i));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    trees.push(buildTree(data, perm.slice(0, psi), maxDepth, rng));
  }
  return { psi, nFeatures: data[0]!.length, trees };
}

function pathLength(tree: Tree, x: readonly number[]): number {
  let i = 0;
  let depth = 0;
  for (;;) {
    const n = tree[i]!;
    if (n[0] < 0) return depth + avgPathLength(n[1]);
    i = x[n[0]]! < n[1] ? n[2] : n[3];
    depth++;
  }
}

/** Anomaly score ∈ (0,1): càng gần 1 càng bất thường, ~0.5 là bình thường. */
export function scoreIsolationForest(model: IsolationForest, x: readonly number[]): number {
  let sum = 0;
  for (const tree of model.trees) sum += pathLength(tree, x);
  const avg = sum / model.trees.length;
  return 2 ** (-avg / avgPathLength(model.psi));
}
