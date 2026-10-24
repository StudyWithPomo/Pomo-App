/* Pet sprite: 16x16 pixel data shared with the firmware.
   Every layer is a list of [x, y, w, h] rectangles in sprite pixels,
   painted in one palette colour. Bodies, faces, moods and accessories
   all live in the same grid, so any mood works on any body. */
(function () {
  const R = (x, y, w = 1, h = 1) => [x, y, w, h];
  const HAPPY_LINE = [R(4, 8), R(5, 7), R(6, 8), R(9, 8), R(10, 7), R(11, 8), R(6, 10), R(7, 11, 2), R(9, 10)];

  const PET = {
    body: [R(5, 4, 6), R(4, 5, 8), R(3, 6, 10, 6), R(4, 12, 8)],
    line: [R(5, 3, 6), R(4, 4), R(11, 4), R(3, 5), R(12, 5), R(2, 6, 1, 6), R(13, 6, 1, 6), R(3, 12), R(12, 12), R(4, 13, 8), R(5, 14, 2), R(9, 14, 2)],
    metal: { shade: [R(4, 12, 8), R(3, 11), R(12, 11)], hi: [R(5, 5, 2), R(4, 6)], rivet: [R(3, 7), R(12, 7)] },
    nubs: { line: [R(5, 2), R(10, 2)] },
    key: { shade: [R(5, 0, 2, 2), R(9, 0, 2, 2)], line: [R(7, 0, 2, 3)] },
    cat: {
      line: [R(3, 1, 1, 4), R(4, 2), R(12, 1, 1, 4), R(11, 2), R(0, 9, 2), R(0, 11, 2), R(14, 9, 2), R(14, 11, 2)],
      cheek: [R(4, 3), R(11, 3)], body: [R(4, 4), R(11, 4)]
    },
    dog: {
      line: [R(3, 2, 2), R(2, 3), R(1, 4), R(0, 5, 1, 4), R(1, 9, 2), R(11, 2, 2), R(13, 3), R(14, 4), R(15, 5, 1, 4), R(13, 9, 2), R(7, 9, 2)],
      shade: [R(3, 3, 2), R(2, 4, 2), R(1, 5, 2, 4), R(11, 3, 2), R(12, 4, 2), R(13, 5, 2, 4)]
    },
    moods: {
      happy: { line: HAPPY_LINE, cheek: [R(4, 10), R(11, 10)] },
      love: { line: HAPPY_LINE, cheek: [R(3, 10, 2), R(11, 10, 2), R(4, 9), R(11, 9)] },
      focus: { line: [R(5, 7, 2, 2), R(9, 7, 2, 2), R(7, 10, 2)], body: [R(5, 7), R(9, 7)] },
      annoyed: { line: [R(4, 6, 2), R(6, 7), R(10, 6, 2), R(9, 7), R(5, 8, 2), R(9, 8, 2), R(7, 10, 2), R(6, 11), R(9, 11)] },
      shh: { line: [R(4, 8, 3), R(9, 8, 3), R(7, 10, 2, 2)], cheek: [R(4, 10), R(11, 10)] },
      sleep: { line: [R(4, 8, 3), R(9, 8, 3), R(7, 10, 2)] },
      sad: { line: [R(6, 6), R(5, 7), R(9, 6), R(10, 7), R(5, 8, 2), R(9, 8, 2), R(7, 10, 2), R(6, 11), R(9, 11)], hi: [R(4, 9)] }
    },
    goggles: { shade: [R(3, 5, 2), R(7, 5, 2), R(11, 5, 2)], mono: [R(5, 4, 2, 2), R(9, 4, 2, 2)] },
    tie: { cheek: [R(5, 12, 2, 2), R(9, 12, 2, 2)], line: [R(7, 12, 2)] },
    hat: { line: [R(5, 0, 6, 3), R(4, 3, 8)], cheek: [R(5, 2, 6)] },
    monocle: { mono: [R(8, 6, 5), R(8, 10, 5), R(8, 7, 1, 3), R(12, 7, 1, 3), R(13, 11), R(14, 12)] }
  };

  const PALETTES = {
    brass:     { body: '#E2BC72', line: '#2A1A10', cheek: '#B5462A', shade: '#8A6430', hi: '#F4DDA0', rivet: '#6B4A22', mono: '#E6E8E3' },
    copper:    { body: '#D9875A', line: '#2A1A10', cheek: '#8E2F1E', shade: '#8E4A2A', hi: '#F2B992', rivet: '#6A3018', mono: '#F4DDA0' },
    pewter:    { body: '#B9BCB6', line: '#1E1E1E', cheek: '#B5462A', shade: '#6E726C', hi: '#E6E8E3', rivet: '#4E524C', mono: '#E2BC72' },
    verdigris: { body: '#7FBFAE', line: '#12231F', cheek: '#C0563A', shade: '#3F7A6C', hi: '#C2E6DC', rivet: '#2E5A50', mono: '#E2BC72' }
  };

  function drawPet(canvas, opts) {
    const o = Object.assign({ body: 'bot', face: 'plain', color: 'brass', mood: 'happy', level: 1 }, opts);
    const p = PALETTES[o.color] || PALETTES.brass;
    const ctx = canvas.getContext('2d');
    const s = canvas.width / 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    const paint = (layer) => {
      if (!layer) return;
      for (const key of Object.keys(layer)) {
        ctx.fillStyle = p[key];
        for (const [x, y, w, h] of layer[key]) ctx.fillRect(x * s, y * s, w * s, h * s);
      }
    };
    paint({ body: PET.body, line: PET.line });
    paint(PET.metal);
    if (o.body === 'bot') paint(PET.key);
    if (o.body === 'cat') paint(PET.cat);
    if (o.body === 'dog') paint(PET.dog);
    paint(PET.moods[o.mood] || PET.moods.happy);
    if (o.level >= 5) paint(PET.goggles);
    if (o.level >= 10) paint(PET.tie);
    if (o.level >= 15) paint(PET.hat);
    if (o.face === 'monocle') paint(PET.monocle);
  }

  window.StudyPet = { PET, PALETTES, drawPet };
})();
