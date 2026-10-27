(() => {
  "use strict";

  const eye = document.querySelector(".eye");
  const stage = document.querySelector(".eye-stage");
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const columns = 157;
  const rows = 45;
  const texture = ".,:;=+*#%@";
  const glitchSymbols = ["§", "#", "&", "%", "?", "!", "0", "1", "Ø", "Ξ"];

  let animationFrame = 0;
  let cycleStarted = performance.now();
  let lastFrame = "";
  let glitchActive = false;
  let glitchRow = -1;

  // A fixed noise field keeps the iris still between blinks.
  function noise(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function arch(x) {
    // Sinister, focused hooded arch: reduces innocent upper white sclera gap
    const p = Math.max(0, 1 - x * x);
    return 0.33 * Math.pow(p, 1.05);
  }

  function render(openness) {
    // Grid stores { char, type: null | 'pupil' | 'slit' | 'glitch' }
    const grid = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => ({ char: " ", type: null }))
    );

    // 1. Draw eye interior, iris, red pupil, and eyelids
    for (let row = 0; row < rows; row += 1) {
      const y = ((row / (rows - 1)) * 2 - 1) * 0.48;

      for (let column = 0; column < columns; column += 1) {
        const x = (column / (columns - 1)) * 2 - 1;
        const upperLid = -arch(x) * openness;
        const lowerLid = arch(x) * openness * 0.84;
        const upperDistance = Math.abs(y - upperLid);
        const lowerDistance = Math.abs(y - lowerLid);
        const random = noise(column, row);
        let character = " ";
        let type = null;

        if (Math.abs(x) < 0.985 && (upperDistance < 0.011 || lowerDistance < 0.011)) {
          character = upperDistance < 0.007 || lowerDistance < 0.007 ? "=" : "-";
        } else if (y > upperLid && y < lowerLid) {
          const radius = Math.hypot(x, y);
          const angle = Math.atan2(y, x);

          // Red evil pupil
          if (radius < 0.125) {
            const slit = Math.hypot(x * 3.6, y * 0.85);
            if (slit < 0.035) {
              character = "|";
              type = "slit";
            } else if (slit < 0.075) {
              character = random > 0.35 ? "#" : "%";
              type = "pupil";
            } else {
              character = random > 0.4 ? "@" : "%";
              type = "pupil";
            }
          } else if (radius < 0.155 && random > 0.55) {
            // Subtle red veins bleeding into inner iris
            character = random > 0.7 ? "%" : "*";
            type = "pupil";
          } else if (radius < 0.286) {
            const fibers = Math.sin(angle * 63 + Math.sin(radius * 43) * 1.5);
            const fineFibers = Math.sin(angle * 117 - radius * 24);
            const edge = radius > 0.262 ? 0.22 : 0;
            const density = Math.max(0, Math.min(0.99,
              0.43 + fibers * 0.19 + fineFibers * 0.12 + random * 0.19 + edge));
            character = texture[Math.floor(density * texture.length)];

            if (radius < 0.14) character = random > 0.4 ? "%" : "*";
            if (Math.hypot(x + 0.09, y + 0.115) < 0.038) character = "@";
          } else {
            const lidDistance = Math.min(y - upperLid, lowerLid - y);
            const density = Math.max(0, 1 - lidDistance / 0.11);
            if (random < density * 0.78) character = density > 0.7 ? ":" : ".";
            else if (random > 0.975) character = ".";
          }
        }

        grid[row][column] = { char: character, type };
      }
    }

    // 2. Draw dramatic curved upper eyelashes (sweeping winged lashes)
    const numUpperLashes = 21;
    for (let i = 0; i < numUpperLashes; i += 1) {
      const t = i / (numUpperLashes - 1);
      const x0 = -0.88 + t * 1.76;
      const y0 = -arch(x0) * openness;
      const absX = Math.abs(x0);
      const lashLen = (0.055 + 0.095 * Math.pow(absX, 1.3)) * openness;
      const steps = 14;

      for (let s = 1; s <= steps; s += 1) {
        const frac = s / steps;
        const curveX = x0 + Math.sign(x0) * Math.pow(frac, 1.4) * (0.05 + absX * 0.08);
        const curveY = y0 - frac * lashLen;

        const col = Math.round(((curveX + 1) / 2) * (columns - 1));
        const row = Math.round(((curveY / 0.48 + 1) / 2) * (rows - 1));

        if (row >= 0 && row < rows && col >= 0 && col < columns) {
          const currY = ((row / (rows - 1)) * 2 - 1) * 0.48;
          const currUpper = -arch(curveX) * openness;
          if (currY >= currUpper - 0.005) continue;

          let ch = "|";
          if (x0 < -0.12) ch = s === steps ? "/" : "/";
          else if (x0 > 0.12) ch = s === steps ? "\\" : "\\";

          if (grid[row][col].char === " " || grid[row][col].char === ".") {
            grid[row][col] = { char: ch, type: null };
          }
        }
      }
    }

    // 3. Draw subtle menacing lower lashes
    const numLowerLashes = 15;
    for (let i = 0; i < numLowerLashes; i += 1) {
      const t = i / (numLowerLashes - 1);
      const x0 = -0.78 + t * 1.56;
      const y0 = arch(x0) * openness * 0.84;
      const absX = Math.abs(x0);
      const lashLen = (0.024 + 0.032 * absX) * openness;
      const steps = 6;

      for (let s = 1; s <= steps; s += 1) {
        const frac = s / steps;
        const curveX = x0 + Math.sign(x0) * frac * (0.02 + absX * 0.03);
        const curveY = y0 + frac * lashLen;

        const col = Math.round(((curveX + 1) / 2) * (columns - 1));
        const row = Math.round(((curveY / 0.48 + 1) / 2) * (rows - 1));

        if (row >= 0 && row < rows && col >= 0 && col < columns) {
          const currY = ((row / (rows - 1)) * 2 - 1) * 0.48;
          const currLower = arch(curveX) * openness * 0.84;
          if (currY <= currLower + 0.005) continue;

          let ch = "|";
          if (x0 < -0.2) ch = "\\";
          else if (x0 > 0.2) ch = "/";

          if (grid[row][col].char === " ") {
            grid[row][col] = { char: ch, type: null };
          }
        }
      }
    }

    // 4. Corrupt a single row if glitch is active
    if (glitchActive && glitchRow >= 0 && glitchRow < rows) {
      for (let col = 0; col < columns; col += 1) {
        if (grid[glitchRow][col].char !== " ") {
          const sym = glitchSymbols[Math.floor(Math.random() * glitchSymbols.length)];
          grid[glitchRow][col] = { char: sym, type: "glitch" };
        }
      }
    }

    // Build HTML string with span tags for pupil, slit, and glitch
    const lines = [];
    for (let row = 0; row < rows; row += 1) {
      let lineHtml = "";
      let activeSpan = null;

      for (let col = 0; col < columns; col += 1) {
        const cell = grid[row][col];
        if (cell.type !== activeSpan) {
          if (activeSpan) lineHtml += "</span>";
          if (cell.type === "pupil") lineHtml += '<span class="pupil">';
          else if (cell.type === "slit") lineHtml += '<span class="pupil-slit">';
          else if (cell.type === "glitch") lineHtml += '<span class="glitch">';
          activeSpan = cell.type;
        }
        lineHtml += cell.char === "&" ? "&amp;" : cell.char;
      }
      if (activeSpan) lineHtml += "</span>";
      lines.push(lineHtml);
    }

    const frame = lines.join("\n");
    if (frame !== lastFrame) {
      eye.innerHTML = frame;
      lastFrame = frame;
    }
  }

  // Glitch trigger mechanics
  function triggerGlitch() {
    if (document.hidden) return;
    glitchActive = true;
    glitchRow = Math.floor(14 + Math.random() * 18);
    lastFrame = "";
    render(1);

    setTimeout(() => {
      if (glitchActive) {
        glitchRow = Math.floor(14 + Math.random() * 18);
        lastFrame = "";
        render(1);
      }
    }, 60);

    setTimeout(() => {
      glitchActive = false;
      glitchRow = -1;
      lastFrame = "";
      render(1);
    }, 150);
  }

  function scheduleNextGlitch(delayMs) {
    setTimeout(() => {
      triggerGlitch();
      scheduleNextGlitch(45000 + Math.random() * 20000);
    }, delayMs);
  }

  // Initial teaser glitch after 5 seconds, then every ~minute
  scheduleNextGlitch(5000);

  if (stage) {
    stage.addEventListener("click", triggerGlitch);
  }

  // Closing and opening have different speeds, like a natural blink.
  function animate(now) {
    const elapsed = (now - cycleStarted) % 5200;
    let openness = 1;

    if (elapsed >= 4700 && elapsed < 4820) {
      openness = 1 - (elapsed - 4700) / 120;
    } else if (elapsed >= 4820 && elapsed < 4870) {
      openness = 0;
    } else if (elapsed >= 4870 && elapsed < 5090) {
      openness = (elapsed - 4870) / 220;
    }

    // Only generate new ASCII during the blink or glitch; the open eye is static.
    if (openness < 1 || glitchActive || lastFrame !== openFrame) render(openness);
    animationFrame = window.requestAnimationFrame(animate);
  }

  render(1);
  const openFrame = lastFrame;

  function synchronizeAnimation() {
    window.cancelAnimationFrame(animationFrame);
    render(1);
    if (!motionPreference.matches && !document.hidden) {
      cycleStarted = performance.now();
      animationFrame = window.requestAnimationFrame(animate);
    }
  }

  motionPreference.addEventListener("change", synchronizeAnimation);
  document.addEventListener("visibilitychange", synchronizeAnimation);
  synchronizeAnimation();
})();
