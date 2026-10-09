/* Visualizaciones locales: sin dependencias, sin solicitudes a servicios externos. */
const NS = "http://www.w3.org/2000/svg";
const PALETTE = [
  "#176f78",
  "#ce7242",
  "#7667a2",
  "#528653",
  "#b34970",
  "#547caf",
  "#9a7929",
  "#657579",
];
const canonical = (value) =>
  String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
const label = (value) =>
  typeof value === "string" ? value : value?.label || value?.name || "";
const terms = (row) => [
  ...new Set(
    [...(row.keywords || []), ...(row.subjects || [])]
      .map(label)
      .filter(Boolean),
  ),
];
function el(tag, attrs = {}, text = "") {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.textContent = text;
  return node;
}
function svg(tag, attrs = {}, text = "") {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.textContent = text;
  return node;
}
function shell(container, description) {
  container.replaceChildren();
  container.classList.add("viz");
  const info = el("p", { class: "viz-help" }, description),
    controls = el("div", { class: "viz-controls" });
  const stage = el("div", { class: "viz-stage" }),
    canvas = svg("svg", {
      viewBox: "0 0 900 520",
      role: "img",
      "aria-label": description,
    });
  const tip = el("div", { class: "viz-tooltip", hidden: "" });
  stage.append(canvas, tip);
  const status = el("p", { class: "viz-status", "aria-live": "polite" });
  container.append(info, controls, stage, status);
  return { info, controls, stage, canvas, tip, status };
}
function button(parent, text, action) {
  const b = el("button", { type: "button" }, text);
  b.addEventListener("click", action);
  parent.append(b);
  return b;
}
function tooltip(tip, event, text) {
  tip.textContent = text;
  tip.hidden = false;
  const bounds = tip.parentElement.getBoundingClientRect();
  tip.style.left =
    Math.max(
      8,
      Math.min(event.clientX - bounds.left + 12, bounds.width - 270),
    ) + "px";
  tip.style.top = Math.max(8, event.clientY - bounds.top - 48) + "px";
}
function colorKey(rows) {
  const counts = new Map();
  rows.forEach((r) =>
    counts.set(
      r.area || "Sin área",
      (counts.get(r.area || "Sin área") || 0) + 1,
    ),
  );
  const keys = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, 7)
    .map((x) => x[0]);
  return {
    keys,
    color: (area) =>
      PALETTE[
        keys.includes(area || "Sin área") ? keys.indexOf(area || "Sin área") : 7
      ],
  };
}

export function createMap(
  container,
  { onSelect = () => {}, domainRows = [] } = {},
) {
  const ui = shell(
    container,
    "La posición corresponde a una proyección exploratoria del contenido. Cada punto representa una tesis. Arrastrar desplaza la vista; los botones o Ctrl + rueda permiten acercar.",
  );
  let rows = [],
    selectedId = null,
    scale = 1,
    dx = 0,
    dy = 0,
    drag = null,
    moved = false,
    frame = 0;
  const extent = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  const domainColors = domainRows.length ? colorKey(domainRows) : null;
  let layout = "projection",
    viewHeight = 520,
    areaColumns = 0;
  const layoutLabel = el("label", { class: "viz-layout" }, "Agrupar mapa ");
  const layoutSelect = el("select", { "aria-label": "Disposición del mapa" });
  [
    ["projection", "Proximidad temática"],
    ["year", "Por año de defensa"],
    ["area", "Por área temática"],
    ["level", "Por tipo de trabajo"],
  ].forEach(([value, text]) =>
    layoutSelect.append(el("option", { value }, text)),
  );
  layoutLabel.append(layoutSelect);
  ui.controls.append(layoutLabel);
  layoutSelect.addEventListener("change", () => {
    layout = layoutSelect.value;
    scale = 1;
    dx = dy = 0;
    schedule();
  });
  domainRows.forEach((r) => {
    if (
      r.x !== null &&
      r.y !== null &&
      Number.isFinite(Number(r.x)) &&
      Number.isFinite(Number(r.y))
    ) {
      extent.minX = Math.min(extent.minX, +r.x);
      extent.maxX = Math.max(extent.maxX, +r.x);
      extent.minY = Math.min(extent.minY, +r.y);
      extent.maxY = Math.max(extent.maxY, +r.y);
    }
  });
  const world = svg("g");
  ui.canvas.append(world);
  const legend = el("div", { class: "viz-legend" }),
    access = el(
      "label",
      { class: "viz-picker" },
      "Explorar una tesis con el teclado ",
    ),
    select = el("select", { "aria-label": "Seleccionar tesis del mapa" });
  access.append(select);
  container.append(legend, access);
  select.addEventListener("change", () => onSelect(select.value));
  function transform() {
    world.setAttribute(
      "transform",
      `translate(${450 + dx} ${viewHeight / 2 + dy}) scale(${scale}) translate(-450 ${-viewHeight / 2})`,
    );
  }
  function zoom(factor) {
    scale = Math.max(0.7, Math.min(12, scale * factor));
    transform();
  }
  button(ui.controls, "+ Acercar", () => zoom(1.4));
  button(ui.controls, "− Alejar", () => zoom(1 / 1.4));
  button(ui.controls, "Restablecer vista", () => {
    scale = 1;
    dx = dy = 0;
    transform();
  });
  ui.canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false },
  );
  ui.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      dx,
      dy,
      id: event.target.getAttribute("data-id"),
    };
    moved = false;
    ui.canvas.setPointerCapture(event.pointerId);
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const bounds = ui.canvas.getBoundingClientRect();
    const x = event.clientX - drag.x,
      y = event.clientY - drag.y;
    if (Math.abs(x) + Math.abs(y) > 5) moved = true;
    dx = drag.dx + (x * 900) / bounds.width;
    dy = drag.dy + (y * viewHeight) / bounds.height;
    transform();
    ui.tip.hidden = true;
  });
  function release(event) {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    if (ui.canvas.hasPointerCapture(event.pointerId))
      ui.canvas.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup" && !moved && id) onSelect(id);
  }
  ui.canvas.addEventListener("pointerup", release);
  ui.canvas.addEventListener("pointercancel", release);
  function draw() {
    world.replaceChildren();
    legend.replaceChildren();
    viewHeight = 520;
    ui.canvas.setAttribute("data-layout", layout);
    const colors = domainColors || colorKey(rows);
    const valid =
      layout !== "projection"
        ? rows
        : rows.filter(
            (r) =>
              r.x !== null &&
              r.y !== null &&
              Number.isFinite(Number(r.x)) &&
              Number.isFinite(Number(r.y)),
          );
    valid.forEach((r) => {
      if (
        r.x === null ||
        r.y === null ||
        !Number.isFinite(Number(r.x)) ||
        !Number.isFinite(Number(r.y))
      )
        return;
      extent.minX = Math.min(extent.minX, +r.x);
      extent.maxX = Math.max(extent.maxX, +r.x);
      extent.minY = Math.min(extent.minY, +r.y);
      extent.maxY = Math.max(extent.maxY, +r.y);
    });
    let xy = (r) => [
      60 + ((+r.x - extent.minX) / (extent.maxX - extent.minX || 1)) * 780,
      55 + ((+r.y - extent.minY) / (extent.maxY - extent.minY || 1)) * 410,
    ];
    const domain = domainRows.length ? domainRows : rows;
    const groupOf = (r) => layout === "level" ? (r.level || "Sin tipo registrado") : (r.area || "Sin área");
    const counts = new Map();
    domain.forEach((r) =>
      counts.set(
        groupOf(r),
        (counts.get(groupOf(r)) || 0) + 1,
      ),
    );
    const areas = [...counts.keys()].sort(
      (a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, "es"),
    );
    const currentCounts = new Map();
    rows.forEach((r) =>
      currentCounts.set(
        groupOf(r),
        (currentCounts.get(groupOf(r)) || 0) + 1,
      ),
    );
    const text = (x, y, value, anchor = "start") =>
      world.append(
        svg("text", { x, y, "text-anchor": anchor, class: "viz-axis" }, value),
      );
    const description = {
      projection:
        "La posición corresponde a una proyección exploratoria del contenido.",
      year: "El eje horizontal indica el año de defensa registrado. Las franjas separan áreas principales; la posición vertical dentro de cada franja solo evita superposiciones.",
      level: "Las tesis se agrupan por tipo de trabajo: doctorado, maestría y especialización. La posición dentro de cada grupo solo separa puntos.",
      area: "Las tesis se agrupan por el área principal registrada. La posición dentro de cada grupo solo separa puntos; no representa similitud temática.",
    };
    ui.info.textContent =
      description[layout] +
      " Cada punto representa una tesis. Arrastrar desplaza la vista; los botones o Ctrl + rueda permiten acercar.";
    ui.canvas.setAttribute("aria-label", ui.info.textContent);
    if (layout === "area" || layout === "level") {
      const width = ui.stage.getBoundingClientRect().width;
      const cols = Math.min(
          Math.max(areas.length, 1),
          width < 540 ? 2 : width < 760 ? 3 : 4,
        ),
        groups = Math.ceil(areas.length / cols) || 1,
        cw = 840 / cols,
        ch = 150,
        positions = new Map();
      areaColumns = width < 540 ? 2 : width < 760 ? 3 : 4;
      viewHeight = 90 + groups * ch;
      areas.forEach((area, index) => {
        const x = 30 + (index % cols) * cw,
          y = 45 + Math.floor(index / cols) * ch;
        world.append(
          svg("rect", {
            x: x + 4,
            y: y + 4,
            width: cw - 8,
            height: ch - 8,
            rx: 12,
            class: "viz-group-box",
          }),
        );
        text(x + 14, y + 23, area.length > 31 ? area.slice(0, 28) + "…" : area);
        text(
          x + 14,
          y + 40,
          `${currentCounts.get(area) || 0} visibles / ${counts.get(area)} tesis`,
        );
        const members = domain
          .filter((r) => groupOf(r) === area)
          .sort((a, b) => String(a.id).localeCompare(String(b.id), "es"));
        members.forEach((r, i) => {
          const angle = i * 2.399963229728653,
            radius = Math.sqrt((i + 0.5) / members.length);
          positions.set(r.id, [
            x + cw / 2 + Math.cos(angle) * radius * (cw / 2 - 22),
            y + 100 + Math.sin(angle) * radius * 32,
          ]);
        });
      });
      xy = (r) => positions.get(r.id) || [450, 260];
    } else if (layout === "year") {
      const yearOf = (r) =>
        r.year !== null &&
        r.year !== "" &&
        Number.isFinite(Number(r.year)) &&
        Number(r.year) > 0
          ? Number(r.year)
          : null;
      const years = domain.map(yearOf).filter((y) => y !== null),
        lo = years.length ? Math.min(...years) : 0,
        hi = years.length ? Math.max(...years) : 0;
      const laneAreas = areas.slice(0, 7),
        hasOthers = areas.length > 7,
        lanes = [...laneAreas, ...(hasOthers ? ["Otras áreas"] : [])];
      const lane = (r) => {
        const index = laneAreas.indexOf(r.area || "Sin área");
        return index < 0 ? lanes.length - 1 : index;
      };
      const positions = new Map(),
        band = 370 / Math.max(lanes.length, 1),
        xFor = (year) => 75 + ((year - lo) / (hi - lo || 1)) * 680;
      lanes.forEach((area, i) => {
        const y = 55 + i * band;
        world.append(
          svg("line", {
            x1: 65,
            x2: 865,
            y1: y + band,
            y2: y + band,
            class: "viz-grid",
          }),
        );
        text(76, y + 13, area.length > 34 ? area.slice(0, 31) + "…" : area);
      });
      const groups = new Map();
      domain.forEach((r) => {
        const key = `${yearOf(r)}:${lane(r)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
      groups.forEach((members) => {
        members.sort((a, b) => String(a.id).localeCompare(String(b.id), "es"));
        members.forEach((r, i) =>
          positions.set(r.id, [
            yearOf(r) === null ? 835 : xFor(yearOf(r)),
            55 +
              lane(r) * band +
              23 +
              ((i + 0.5) / members.length) * Math.max(4, band - 28),
          ]),
        );
      });
      const tick = Math.max(1, Math.ceil((hi - lo) / 8 / 5) * 5);
      if (years.length) {
        const ticks = new Set([lo, hi]);
        for (let year = Math.ceil(lo / tick) * tick; year <= hi; year += tick)
          if (year - lo > tick * 0.55 && hi - year > tick * 0.55)
            ticks.add(year);
        [...ticks]
          .sort((a, b) => a - b)
          .forEach((year) => text(xFor(year), 454, String(year), "middle"));
      }
      text(835, 454, "Sin fecha", "middle");
      text(450, 485, "Año de defensa registrado", "middle");
      xy = (r) => positions.get(r.id) || [835, 260];
    }
    for (const r of valid) {
      const [x, y] = xy(r);
      const active = r.id === selectedId;
      const dot = svg("circle", {
        cx: x,
        cy: y,
        r: active ? 8 : 4.5,
        fill: colors.color(r.area),
        opacity: active ? 1 : 0.75,
        stroke: active ? "#182d35" : "#fff",
        "stroke-width": active ? 2 : 1,
        class: "viz-dot",
        "data-id": r.id,
      });
      dot.append(
        svg(
          "title",
          {},
          `${r.title} · ${r.year || "Sin fecha"} · ${r.area || "Sin área"}`,
        ),
      );
      dot.addEventListener("pointerenter", (event) => {
        if (!drag) tooltip(ui.tip, event, r.title);
      });
      dot.addEventListener("pointerleave", () => (ui.tip.hidden = true));
      world.append(dot);
      if (active) {
        world.append(dot);
        const text = svg(
          "text",
          { x: x + 12, y: y - 12, class: "viz-map-label" },
          r.title.length > 65 ? r.title.slice(0, 62) + "…" : r.title,
        );
        world.append(text);
      }
    }
    [
      ...colors.keys,
      ...(rows.some((r) => !colors.keys.includes(r.area || "Sin área"))
        ? ["Otras áreas"]
        : []),
    ].forEach((key, index) => {
      const item = el("span", {}, key);
      item.style.setProperty("--legend-color", PALETTE[index]);
      legend.append(item);
    });
    select.replaceChildren(el("option", { value: "" }, "Elegí una tesis…"));
    rows.forEach((r) =>
      select.append(
        el("option", { value: r.id }, `${r.title} (${r.year || "s/f"})`),
      ),
    );
    select.value = selectedId || "";
    ui.status.textContent = rows.length
      ? `${valid.length} tesis visibles en el mapa${rows.length > valid.length ? `; ${rows.length - valid.length} sin coordenadas` : ""}. Colores por área principal. Las áreas secundarias se conservan en las fichas.${layout === "projection" ? "" : " Agrupamiento descriptivo, no clasificación automática."}`
      : "No hay tesis que coincidan con los filtros.";
    ui.canvas.setAttribute("viewBox", `0 0 900 ${viewHeight}`);
    transform();
  }
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const width = ui.stage.getBoundingClientRect().width;
          const columns = width < 540 ? 2 : width < 760 ? 3 : 4;
          if ((layout === "area" || layout === "level") && columns !== areaColumns) schedule();
          else transform();
        })
      : null;
  observer?.observe(ui.stage);
  return {
    update(nextRows, id) {
      rows = nextRows || [];
      selectedId = id;
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      container.replaceChildren();
    },
  };
}

export function createNetwork(container, { onSelect = () => {} } = {}) {
  const ui = shell(
    container,
    "Una red local conecta la tesis elegida con trabajos similares y temas explícitos compartidos. Las líneas continuas representan similitud de contenido textual; las punteadas, temas compartidos.",
  );
  const list = el("div", { class: "viz-relations" });
  container.append(list);
  let frame = 0;
  function draw(center, rows, options) {
    ui.canvas.replaceChildren();
    list.replaceChildren();
    ui.tip.hidden = true;
    const selected = center || rows[0];
    if (!selected) {
      ui.status.textContent =
        "No hay tesis para representar. Probá ampliar los filtros.";
      return;
    }
    const limit = Math.max(1, Math.min(12, Number(options?.limit) || 10)),
      byId = new Map(rows.map((r) => [r.id, r]));
    const linked = (selected.neighbors || [])
      .filter((n) => n.id !== selected.id && byId.has(n.id))
      .slice(0, limit)
      .map((n) => ({
        row: byId.get(n.id),
        score: Number(n.score) || 0,
        kind: "lexical",
      }));
    const selectedTerms = new Map(
      terms(selected).map((t) => [canonical(t), t]),
    );
    const shared = new Map();
    const linkedIds = new Set([selected.id, ...linked.map((n) => n.row.id)]);
    const documental = rows
      .filter((row) => !linkedIds.has(row.id))
      .map((row) => ({
        row,
        overlap: terms(row).filter((t) => selectedTerms.has(canonical(t))),
        kind: "documental",
      }))
      .filter((item) => item.overlap.length)
      .sort(
        (a, b) =>
          b.overlap.length - a.overlap.length ||
          a.row.title.localeCompare(b.row.title, "es"),
      )
      .slice(0, 6);
    linked.push(...documental);
    linked.forEach(({ row }) =>
      terms(row).forEach((t) => {
        const key = canonical(t);
        if (selectedTerms.has(key)) {
          if (!shared.has(key))
            shared.set(key, { label: selectedTerms.get(key), ids: new Set() });
          shared.get(key).ids.add(row.id);
        }
      }),
    );
    const topics = [...shared.values()]
      .sort(
        (a, b) =>
          b.ids.size - a.ids.size || a.label.localeCompare(b.label, "es"),
      )
      .slice(0, 6);
    const colors = colorKey([selected, ...linked.map((x) => x.row)]),
      positions = new Map([[selected.id, [450, 240]]]);
    linked.forEach(({ row }, i) => {
      const angle =
        -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(linked.length, 1);
      positions.set(row.id, [
        450 + 310 * Math.cos(angle),
        240 + 165 * Math.sin(angle),
      ]);
    });
    const edge = (a, b, topic = false) =>
      ui.canvas.append(
        svg("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          stroke: topic ? "#ad8545" : "#95afb3",
          "stroke-width": topic ? 1.3 : 2,
          "stroke-dasharray": topic ? "4 5" : "none",
          opacity: topic ? 0.55 : 0.65,
        }),
      );
    linked.forEach(({ row, kind }) =>
      edge(
        positions.get(selected.id),
        positions.get(row.id),
        kind === "documental",
      ),
    );
    topics.forEach((topic, i) => {
      const pos = [100 + i * 140, 485];
      edge(pos, positions.get(selected.id), true);
      topic.ids.forEach((id) => edge(pos, positions.get(id), true));
      const group = svg("g");
      group.append(
        svg("rect", {
          x: pos[0] - 62,
          y: pos[1] - 15,
          width: 124,
          height: 30,
          rx: 15,
          fill: "#faf0d9",
          stroke: "#d9bb81",
        }),
      );
      group.append(
        svg(
          "text",
          {
            x: pos[0],
            y: pos[1] + 4,
            "text-anchor": "middle",
            class: "viz-topic",
          },
          topic.label.length > 18
            ? topic.label.slice(0, 16) + "…"
            : topic.label,
        ),
      );
      group.append(svg("title", {}, topic.label));
      ui.canvas.append(group);
    });
    [selected, ...linked.map((x) => x.row)].forEach((row) => {
      const active = row.id === selected.id,
        [x, y] = positions.get(row.id);
      const group = svg("g", {
        class: "viz-node",
        tabindex: "0",
        role: "button",
        "aria-label": `Abrir tesis: ${row.title}`,
      });
      group.append(
        svg("circle", {
          cx: x,
          cy: y,
          r: active ? 28 : 15,
          fill: colors.color(row.area),
          stroke: "#fff",
          "stroke-width": 4,
        }),
      );
      group.append(svg("title", {}, row.title));
      const text = svg(
        "text",
        {
          x,
          y: y + (active ? 45 : 30),
          "text-anchor": "middle",
          class: "viz-node-label",
        },
        row.title.length > 34 ? row.title.slice(0, 31) + "…" : row.title,
      );
      group.append(text);
      const choose = () => onSelect(row.id);
      group.addEventListener("click", choose);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
      group.addEventListener("pointerenter", (event) =>
        tooltip(ui.tip, event, row.title),
      );
      group.addEventListener("pointerleave", () => (ui.tip.hidden = true));
      ui.canvas.append(group);
    });
    ui.status.textContent = `${center ? "" : "Se muestra la primera tesis del resultado. "}${linked.length - documental.length} vecinos por similitud de contenido textual y ${documental.length} trabajos adicionales por temas documentados, dentro de los filtros actuales. Se muestran hasta 6 temas compartidos. La similitud de contenido textual es exploratoria, no una validación científica.${center && !byId.has(center.id) ? " La tesis central está fuera de los filtros actuales." : ""}`;
    list.append(el("h3", {}, "Conexiones de la tesis"));
    if (!linked.length)
      list.append(
        el(
          "p",
          {},
          "No hay conexiones por similitud ni temas explícitos dentro de estos filtros. Ampliá la selección para explorar otras conexiones.",
        ),
      );
    linked.forEach(({ row, score, kind }) => {
      const item = el("div", { class: "viz-relation" });
      button(item, row.title, () => onSelect(row.id));
      const overlap = terms(row).filter((t) => selectedTerms.has(canonical(t)));
      item.append(
        el(
          "p",
          {},
          `${kind === "lexical" ? `Similitud de contenido textual: ${score.toFixed(3)} (escala 0–1).` : "Relación documental por tema explícito; no se asigna un puntaje de similitud."}${overlap.length ? " Temas compartidos: " + overlap.join("; ") + "." : " Sin tema explícito compartido."}`,
        ),
      );
      list.append(item);
    });
  }
  return {
    update(center, rows, options = {}) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw(center, rows || [], options));
    },
    destroy() {
      cancelAnimationFrame(frame);
      container.replaceChildren();
    },
  };
}
