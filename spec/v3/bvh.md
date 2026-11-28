# BVH spec (v3)

Reference: `templates/web-project/src/lib/bvh.js`. Vectors: `spec/v3/vectors/bvh.json` (regenerate/check with `node spec/v3/gen-vectors.mjs [--check]`). Numeric tolerance 1e-9 (abs); indices, counts, `nodeCount`, `bytes` and `fnv1a32` are exact.

## Build (deterministic)
Input: triangles (flat, 9 f64/tri) or AABBs (flat, 6 f64/box). Everything is computed in Float64. Top-down with an explicit stack (left child processed first). A range of <= `maxLeafSize` (default 4) prims is a leaf; otherwise:
1. Centroid bounds over the range. Per axis x,y,z with non-zero extent: 16 bins, bin = min(15, floor(16*(c-cmin)/ext)).
2. Cost of each of the 15 splits = `nL*halfArea(L) + nR*halfArea(R)` (half area = dx*dy+dy*dz+dz*dx of the union of prim bounds); splits with an empty side are skipped.
3. Best = strictly lowest cost; ties keep the lower axis, then the lower split index.
4. Stable partition of the index range (bin <= split goes left, original relative order kept).
5. If all centroids coincide, split at `start + floor(count/2)` in current order.
Children are allocated as an adjacent pair: `left = nodesUsed; right = left+1; nodesUsed += 2` (root = node 0, first pair = nodes 1,2). Node bounds are rounded OUTWARD to Float32 (min toward -inf, max toward +inf), so traversal never misses.

## Serialized buffer (little-endian, all words 4 bytes)
```
header 16 u32: [0]=0x33485642 'BVH3' magic, [1]=version 1, [2]=kind (0 triangles, 1 AABBs), [3]=nodeCount, [4]=primCount,
               [5]=nodesOffsetWords (16), [6]=orderOffsetWords, [7]=primsOffsetWords, [8]=primStrideWords (9 tri / 6 aabb), [9..15]=0
nodes  nodeCount * 8 words at nodesOffsetWords, 32 bytes each:
   w0..w2 f32 bounds min x,y,z      w3 u32 leftFirst
   w4..w6 f32 bounds max x,y,z      w7 u32 count
   count == 0  -> interior: left child = node leftFirst, right child = node leftFirst+1
   count  > 0  -> leaf: prims leftFirst .. leftFirst+count-1 (indices into the PRIMS section, i.e. leaf order)
order  primCount u32 at orderOffsetWords: order[leafIndex] = original primitive index
prims  primCount * stride f32 at primsOffsetWords, in LEAF order: tri = ax,ay,az,bx,by,bz,cx,cy,cz ; aabb = minx,miny,minz,maxx,maxy,maxz
```
Total words = `primsOffsetWords + primCount*stride`; orderOffset = 16 + 8*nodeCount; primsOffset = orderOffset + primCount. An empty BVH has nodeCount 1 (root count 0, leftFirst 0, zero bounds) and primCount 0.
A WGSL consumer binds the buffer as `array<u32>` and reads floats with `bitcast<f32>`, or binds it twice (u32 and f32 views). Node i starts at word `16 + 8*i`.

## Traversal contract (for ports)
Closest-hit: stack starting at the root; at an interior node test both child boxes (slab test with inclusive bounds; axis with direction component exactly 0 uses an inclusive containment test; the far slab is widened by factor 1+1e-6 to be conservative), visit the nearer child first (tie: left), skip boxes whose entry `t > tmax`; at leaves test each prim and keep the hit with the smallest `t`, ties broken by the LOWER original index; shrink `tmax` to the hit `t` (inclusive, so equal-t ties still reach lower indices). Triangle test is Moller-Trumbore with inclusive edges (barycentric slack 1e-12), parallel/degenerate triangles never hit, optional back-face cull. Prim `t` uses the f32-rounded vertex data in the buffer (JS keeps the f64 build data; results agree within f32 precision ~1e-6 relative, vectors use the f64 reference).

## Queries
`queryAABB(box)`: ascending original indices of prims overlapping the box inclusively (triangles: exact 13-axis SAT; AABBs: interval overlap). `querySphere(c,r)`: prims whose closest point is within `r` inclusive.

## Refit
`refit(bvh, newPrims)`: same prim count, original order; topology and `order` unchanged; node bounds recomputed bottom-up (children have higher indices than parents, so iterate nodes from last to first). Quality degrades under large motion; rebuild when needed.
