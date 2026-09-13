export type TreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
};

export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "dir", children: [] };

  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path) continue;
    const parts = path.split("/").filter(Boolean);
    let current = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      current.children ??= [];
      let next = current.children.find((child) => child.name === name);
      if (!next) {
        next = {
          name,
          path: prefix,
          kind: isFile ? "file" : "dir",
          children: isFile ? undefined : [],
        };
        current.children.push(next);
      } else if (!isFile && next.kind === "file") {
        next.kind = "dir";
        next.children ??= [];
      }
      current = next;
    }
  }

  sortTree(root);
  return root.children ?? [];
}

function sortTree(node: TreeNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

export function flattenVisible(
  nodes: TreeNode[],
  expanded: Set<string>,
): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = [];
  function walk(list: TreeNode[], depth: number) {
    for (const node of list) {
      out.push({ node, depth });
      if (node.kind === "dir" && node.children && expanded.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(nodes, 0);
  return out;
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  function keep(node: TreeNode): TreeNode | null {
    if (node.kind === "file") {
      return node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q)
        ? node
        : null;
    }
    const children = (node.children ?? []).map(keep).filter(Boolean) as TreeNode[];
    if (children.length === 0 && !node.path.toLowerCase().includes(q)) return null;
    return { ...node, children };
  }
  return nodes.map(keep).filter(Boolean) as TreeNode[];
}
