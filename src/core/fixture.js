// Deliberately hand-authored, not an astronomical catalog or live sky.
export const fixture = {
  id: 'orion-fixture', name: 'ORION / fixture', source: 'fixture',
  stars: [
    { id: 'betelgeuse', x: 0.28, y: 0.2 }, { id: 'bellatrix', x: 0.72, y: 0.24 },
    { id: 'mintaka', x: 0.60, y: 0.48 }, { id: 'alnilam', x: 0.50, y: 0.51 },
    { id: 'alnitak', x: 0.40, y: 0.54 }, { id: 'saiph', x: 0.30, y: 0.82 },
    { id: 'rigel', x: 0.75, y: 0.77 }
  ],
  edges: [[0,1],[1,2],[2,3],[3,4],[4,0],[4,5],[5,6],[6,2]]
};
