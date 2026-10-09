import { createMap, createNetwork } from "./visualizations.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const arr = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const text = (v) =>
  arr(v)
    .map((x) =>
      typeof x === "object"
        ? (x.name ?? x.value ?? x.text ?? JSON.stringify(x))
        : x,
    )
    .join("; ");
const fold = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
const safeUrl = (v) => {
  try {
    const u = new URL(v);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
let rows = [],
  filtered = [],
  data,
  limit = 24,
  map,
  network,
  view = "catalog",
  selected = "",
  savedOnly = false,
  compare = new Set(),
  saved = new Set(),
  detailCache = new Map(),
  detailToken = 0,
  toastTimer,
  returnFocus,
  sourceAlias = "";
function canonicalId(id) {
  const seen = new Set();
  while (data?.aliases?.[id] && !seen.has(id)) {
    seen.add(id);
    id =
      typeof data.aliases[id] === "string"
        ? data.aliases[id]
        : data.aliases[id].canonicalId || id;
  }
  return id;
}
try {
  saved = new Set(
    JSON.parse(localStorage.getItem("fcm-saved") || "[]").filter(
      (x) => typeof x === "string",
    ),
  );
} catch {}
const stateKeys = [
  "q",
  "area",
  "level",
  "from",
  "to",
  "sort",
  "abstract",
  "pdf",
  "view",
  "id",
  "saved",
  "open",
  "origin",
];
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function readState() {
  const p = new URLSearchParams(location.hash.slice(1));
  $("#query").value = p.get("q") || "";
  for (const k of ["area", "level", "from", "to", "sort"])
    $("#" + k).value = p.get(k) || (k === "sort" ? "recent" : "");
  for (const k of ["abstract", "pdf"]) $("#" + k).checked = p.get(k) === "1";
  view = ["catalog", "map", "network"].includes(p.get("view"))
    ? p.get("view")
    : "catalog";
  const requestedId = p.get("id") || "";
  selected = canonicalId(requestedId);
  sourceAlias =
    p.get("origin") || (selected !== requestedId ? requestedId : "");
  if (selected !== requestedId) {
    p.set("id", selected);
    p.set("origin", requestedId);
    p.set("open", "1");
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search + "#" + p.toString(),
    );
  }
  savedOnly = p.get("saved") === "1";
  limit = history.state?.limit || 24;
  render();
  if (selected && p.get("open") === "1") openDetail(selected, false);
  else if ($("#dialog").open) $("#dialog").close();
  requestAnimationFrame(() => {
    if (history.state?.scrollY != null)
      window.scrollTo(0, history.state.scrollY);
    if (!$("#dialog").open && returnFocus) {
      const target = $$("[data-open]").find(
        (b) => b.dataset.open === returnFocus,
      );
      target?.focus({ preventScroll: true });
      returnFocus = "";
    }
  });
}
function writeState(patch = {}) {
  const p = new URLSearchParams();
  const values = {
    q: $("#query").value.trim(),
    area: $("#area").value,
    level: $("#level").value,
    from: $("#from").value,
    to: $("#to").value,
    sort: $("#sort").value,
    abstract: $("#abstract").checked ? "1" : "",
    pdf: $("#pdf").checked ? "1" : "",
    view,
    id: selected,
    saved: savedOnly ? "1" : "",
    open: "",
    origin: patch.id && patch.id !== selected ? "" : sourceAlias,
    ...patch,
  };
  for (const k of stateKeys)
    if (
      values[k] &&
      !(k === "sort" && values[k] === "recent") &&
      !(k === "view" && values[k] === "catalog")
    )
      p.set(k, values[k]);
  const hash = p.toString();
  if (location.hash.slice(1) !== hash) {
    history.replaceState(
      { ...history.state, scrollY: window.scrollY, limit },
      "",
    );
    history.pushState(
      {
        scrollY: window.scrollY,
        limit: patch.open === "1" || patch.view ? limit : 24,
        modal: patch.open === "1",
      },
      "",
      location.pathname + location.search + (hash ? "#" + hash : ""),
    );
    readState();
  } else render();
}
function matches(r, omit = "") {
  const terms = fold($("#query").value).trim().split(/\s+/).filter(Boolean);
  if (!terms.every((t) => r._search.includes(t))) return false;
  if (
    omit !== "area" &&
    $("#area").value &&
    !arr(r._areas).includes($("#area").value)
  )
    return false;
  if (omit !== "level" && $("#level").value && r.level !== $("#level").value)
    return false;
  const from = Number($("#from").value),
    to = Number($("#to").value);
  if (from && (!r.year || r.year < from)) return false;
  if (to && (!r.year || r.year > to)) return false;
  if ($("#abstract").checked && !r.hasAbstract) return false;
  if ($("#pdf").checked && !r.pdfCount) return false;
  if (savedOnly && !saved.has(r.id)) return false;
  return true;
}
function updateFacets() {
  for (const key of ["area", "level"]) {
    const el = $("#" + key),
      current = el.value,
      counts = new Map();
    rows
      .filter((r) => matches(r, key))
      .forEach((r) =>
        (key === "area" ? r._areas : [r.level])
          .filter(Boolean)
          .forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)),
      );
    const all = [
      ...new Set(
        rows
          .flatMap((r) => (key === "area" ? r._areas : [r.level]))
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    el.innerHTML =
      `<option value="">${key === "area" ? "Todas las áreas" : "Todos los niveles"}</option>` +
      all
        .map(
          (v) =>
            `<option value="${esc(v)}">${esc(v)} (${counts.get(v) || 0})</option>`,
        )
        .join("");
    el.value = current;
  }
}
const flagLabels = {
  clasificacion_pendiente: "Área pendiente de clasificación",
  facultad_distinta: "Alcance institucional por revisar",
  titulo_coincidente: "Título coincidente: requiere cotejo",
};
function card(r) {
  return `<article class="card"><div class="card-top"><span class="tag">${esc(r.level || "Nivel sin informar")}</span><span>${esc(r.year || "Sin fecha")}</span></div><h3><button data-open="${esc(r.id)}">${esc(r.title)}</button></h3><p class="authors">${esc(text(r.authors) || "Autoría sin informar")}</p><div class="tags">${r._areas
    .slice(0, 3)
    .map((a) => `<span>${esc(a)}</span>`)
    .join(
      "",
    )}</div>${arr(r.flags).length ? `<p class="flag">◌ ${esc(arr(r.flags).includes("facultad_distinta") ? flagLabels.facultad_distinta : arr(r.flags).includes("titulo_coincidente") ? flagLabels.titulo_coincidente : flagLabels.clasificacion_pendiente)}</p>` : ""}<div class="card-bottom"><button data-save="${esc(r.id)}" aria-label="${saved.has(r.id) ? "Quitar de guardadas" : "Guardar tesis"}" aria-pressed="${saved.has(r.id)}">${saved.has(r.id) ? "★ Guardada" : "☆ Guardar"}</button><label><input type="checkbox" data-compare="${esc(r.id)}" ${compare.has(r.id) ? "checked" : ""}> Comparar</label><button data-open="${esc(r.id)}">Leer ficha ↗</button></div></article>`;
}
function render() {
  if (!data) return;
  filtered = rows.filter((r) => matches(r));
  const sort = $("#sort").value;
  filtered.sort(
    sort === "title"
      ? (a, b) => a.title.localeCompare(b.title, "es")
      : (a, b) =>
          sort === "old"
            ? (a.year || 9999) - (b.year || 9999)
            : (b.year || 0) - (a.year || 0),
  );
  updateFacets();
  $("#count").textContent =
    `${filtered.length.toLocaleString("es-AR")} tesis${savedOnly ? " guardadas" : ""}`;
  $("#saved-count").textContent = saved.size;
  $("#saved").setAttribute("aria-pressed", String(savedOnly));
  $("#active").textContent = [
    $("#query").value && `“${$("#query").value}”`,
    $("#area").value,
    $("#level").value,
    $("#from").value && `Desde ${$("#from").value}`,
    $("#to").value && `Hasta ${$("#to").value}`,
    savedOnly && "Tu selección guardada",
  ]
    .filter(Boolean)
    .join(" · ");
  $$("[data-view]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.view === view)),
  );
  $("#results").setAttribute("aria-busy", "false");
  $("#results").innerHTML = filtered.length
    ? filtered.slice(0, limit).map(card).join("")
    : '<div class="empty"><h3>No encontramos tesis con esos criterios.</h3><p>Probá un término más amplio o quitá algún filtro.</p><button data-reset>Limpiar filtros</button></div>';
  $("#more").hidden = filtered.length <= limit;
  $("#more").textContent =
    `Mostrar más tesis (${Math.min(24, filtered.length - limit)} de ${Math.max(0, filtered.length - limit)} restantes)`;
  $("#visual").hidden = view === "catalog";
  $("#visual-note").hidden = view === "catalog";
  if (view !== "catalog") {
    if (view === "map") {
      network?.destroy();
      network = null;
      if (!map)
        map = createMap($("#visual"), {
          domainRows: rows,
          onSelect: (id) => openDetail(typeof id === "object" ? id.id : id),
        });
      map.update(filtered, selected);
      $("#visual-note").textContent =
        "La cercanía representa similitud exploratoria. Los grupos automáticos no constituyen categorías científicas validadas.";
    } else {
      map?.destroy();
      map = null;
      if (!network)
        network = createNetwork($("#visual"), {
          onSelect: (id) => openDetail(typeof id === "object" ? id.id : id),
        });
      network.update(
        rows.find((r) => r.id === selected) || filtered[0],
        filtered,
        { allRows: rows },
      );
      $("#visual-note").textContent =
        "Seleccioná una tesis para recorrer relaciones documentales. Las coincidencias de nombres no verifican la identidad de una persona.";
    }
  } else {
    map?.destroy();
    network?.destroy();
    map = network = null;
  }
  $("#comparebar").hidden = compare.size === 0;
  $("#comparecount").textContent = `${compare.size} de 3 tesis`;
  $("#compare").disabled = compare.size < 2;
}
async function getDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);
  const response = await fetch(
    new URL(
      `../data/details/${encodeURIComponent(id.replaceAll("/", "_"))}.json`,
      import.meta.url,
    ),
  );
  if (!response.ok) throw new Error("No se pudo cargar la ficha");
  const d = await response.json();
  detailCache.set(id, d);
  return d;
}
function showDialog(html) {
  $("#dialog-content").innerHTML = html;
  if (!$("#dialog").open) $("#dialog").showModal();
}
function pairs(d) {
  return [
    ["Autoría", d.authors],
    ["Dirección", d.directors],
    ["Codirección", d.codirectors],
    ["Título otorgado", d.degree],
    ["Institución", d.grantor],
    ["Facultad", d.faculty],
    ["Institución de desarrollo", d.development_institution],
    ["Fecha de publicación", d.issued],
    ["Fecha de defensa", d.defense],
    ["Área principal", d.area_main],
    ["Áreas secundarias", d.areas_secondary],
    ["Palabras clave", d.keywords],
    ["Materias", d.subjects],
    ["Licencia", d.license],
    ["Disponibilidad", d.availability_status],
    ["Revisión del área", d.area_validation],
    ["Fundamento del área", d.area_rationale],
  ].filter(([, v]) => text(v));
}
function linkList(d) {
  const links = [];
  for (const [name, v] of [
    ["Texto completo", d.pdf],
    ["Registro de origen", d.url],
    ["DOI", d.doi],
    ["Licencia", d.license_url],
  ])
    for (const x of arr(v)) {
      const raw = typeof x === "object" ? (x.url ?? x.href) : x;
      const url = safeUrl(
        name === "DOI" && raw && !String(raw).startsWith("http")
          ? "https://doi.org/" + raw
          : raw,
      );
      if (url && !links.some((l) => l.url === url)) links.push({ name, url });
    }
  return links
    .map(
      (l) =>
        `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)} ↗</a>`,
    )
    .join("");
}
function sourceRecords(d) {
  const originals = arr(d._publication?.sourceRecords);
  if (!originals.length && !sourceAlias) return "";
  return `<section><h3>Registros y variantes de origen</h3>${sourceAlias ? `<p class="hint">La consulta del identificador ${esc(sourceAlias)} corresponde al trabajo publicado con identificador ${esc(d.id)}.</p>` : ""}${
    originals.length
      ? `<p class="hint">Este trabajo reúne registros de origen conservados por separado. Sus títulos y metadatos originales pueden consultarse a continuación.</p><ul class="source-records">${originals
          .map(
            (r) =>
              `<li><strong>${esc(r.title_full || r.title_main || r.title || "Título sin informar")}</strong><p>Identificador de origen: ${esc(r.id)}</p>${safeUrl(r.url) ? `<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">Consultar registro de origen ↗</a>` : ""}<p><button data-source-download="${esc(r.id)}" data-source-parent="${esc(d.id)}">Descargar metadatos originales</button></p><details><summary>Metadatos de este registro</summary><dl>${pairs(
                r,
              )
                .map(
                  ([label, value]) =>
                    `<dt>${esc(label)}</dt><dd>${esc(text(value))}</dd>`,
                )
                .join("")}</dl></details></li>`,
          )
          .join("")}</ul>`
      : ""
  }</section>`;
}
async function openDetail(id, push = true) {
  id = canonicalId(id);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  if (push) {
    returnFocus = id;
    writeState({ id, open: "1" });
    return;
  }
  selected = id;
  const token = ++detailToken;
  showDialog(
    `<p class="eyebrow">FICHA DE TESIS</p><h2 id="dialog-title">${esc(row.title)}</h2><p role="status">Cargando resumen y fuentes…</p>`,
  );
  try {
    const d = await getDetail(id);
    if (token !== detailToken || !$("#dialog").open) return;
    const abstracts = arr(d.abstracts)
      .map((x) =>
        typeof x === "object" ? (x.text ?? x.value ?? x.abstract ?? "") : x,
      )
      .filter(Boolean);
    showDialog(
      `<p class="eyebrow">${esc(row.level || "TESIS")} · ${esc(row.year || "SIN FECHA")}</p><h2 id="dialog-title">${esc(d.title_full || row.title)}</h2><p class="authors">${esc(text(d.authors || row.authors))}</p><div class="detail-actions">${linkList(d)}<button data-save="${esc(id)}">${saved.has(id) ? "★ Guardada" : "☆ Guardar"}</button><button data-cite="${esc(id)}">Copiar referencia</button><button data-share>Copiar enlace</button><button data-network="${esc(id)}">Ver conexiones</button></div>${
        arr(row.flags).length
          ? `<p class="flag">Este registro conserva observaciones de calidad: ${esc(
              arr(row.flags)
                .map((f) => flagLabels[f] || f)
                .join("; "),
            )}. Consultá los metadatos y la fuente.</p>`
          : ""
      }<h3>Resumen</h3>${abstracts.length ? abstracts.map((t) => `<p class="detail-abstract">${esc(t)}</p>`).join("") : "<p>No se dispone de un resumen en los metadatos de origen.</p>"}<details><summary>Metadatos y procedencia</summary><dl>${pairs(
        d,
      )
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(text(v))}</dd>`)
        .join(
          "",
        )}<dt>Identificador</dt><dd>${esc(id)}</dd></dl><p class="hint">Las formas originales se preservan. Los nombres coincidentes no se consideran identidades verificadas.</p>${sourceRecords(d)}</details><h3>Trabajos relacionados</h3><p class="hint">Sugerencias por similitud documental; no representan equivalencia científica.</p><ul>${
        arr(row.neighbors)
          .slice(0, 5)
          .map((n) => rows.find((r) => r.id === n.id))
          .filter(Boolean)
          .map(
            (r) =>
              `<li><button data-open="${esc(r.id)}">${esc(r.title)}</button></li>`,
          )
          .join("") || "<li>No hay sugerencias disponibles.</li>"
      }</ul>`,
    );
  } catch {
    if (token === detailToken)
      showDialog(
        `<h2 id="dialog-title">La ficha no está disponible</h2><p>La colección permanece accesible. Volvé a intentar cargar este registro.</p><button data-retry-detail="${esc(id)}">Reintentar</button>`,
      );
  }
}
function method() {
  if (!data || !rows.length) {
    showDialog(
      "<h2 id=dialog-title>Colección en preparación</h2><p>Esperá a que termine la carga o usá Reintentar si aparece un error.</p>",
    );
    return;
  }
  showDialog(
    `<p class="eyebrow">ACERCA DE LA COLECCIÓN</p><h2 id="dialog-title">Metodología y alcance de la colección</h2><p>Este explorador reúne ${rows.length} trabajos mediante búsqueda, áreas de conocimiento y relaciones documentales. Cada ficha conserva los metadatos de origen y enlaces a sus fuentes.</p><p class="hint">Captura de origen: ${esc(data.snapshot?.retrievedAt ? new Date(data.snapshot.retrievedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "fecha no informada")}. Archivos de origen verificados: ${esc(data.snapshot?.verifiedFiles ?? "consultar documentación")}.</p><div class="detail-actions"><a href="./data/graph.json" download>Grafo JSON</a><a href="./data/graph.ttl" download>Grafo RDF</a></div><h3>Procedimiento de elaboración</h3><p>Los registros se obtuvieron de SEDICI (Servicio de Difusión de la Creación Intelectual), el repositorio institucional de la Universidad Nacional de La Plata. Se cosecharon los metadatos mediante OAI-PMH y se completaron con la información pública de cada registro. Se seleccionaron los trabajos de posgrado de la Facultad y se incorporaron las áreas temáticas de la clasificación editorial de origen.</p><p>La normalización corrigió caracteres, espacios y variantes de escritura sin modificar los títulos ni sustituir los metadatos originales. Se separaron títulos y subtítulos, se ordenaron las fechas y se priorizó el año de defensa. Las decisiones de revisión sobre áreas, denominaciones institucionales y registros repetidos quedaron documentadas; los registros unificados conservan sus fuentes y variantes originales.</p><p>Para más detalle, consultá el <a href="https://github.com/manwithbarba/explorador-interactivo-posgrado-Ciencias-M-dicas-UNLP/blob/main/README.md" target="_blank" rel="noopener noreferrer">README del proyecto</a>. Fuente: <a href="https://sedici.unlp.edu.ar/" target="_blank" rel="noopener noreferrer">SEDICI</a>.</p><h3>Cómo leer los mapas</h3><p>La proximidad temática y las recomendaciones se calculan con TF-IDF y similitud del coseno a partir de títulos, resúmenes y términos de los metadatos. El mapa proyecta esas similitudes en dos dimensiones y puede distorsionar distancias. No constituyen una clasificación clínica o científica validada. Las áreas secundarias se incluyen en la búsqueda y en las relaciones.</p><h3>Calidad y alcance</h3><p>Se preservan los registros con observaciones de calidad y sus metadatos originales. La unificación de registros de un mismo trabajo se documenta en su ficha con las variantes y fuentes de origen. La coincidencia de títulos por sí sola no determina una unificación. Los nombres coincidentes no se consideran identidades verificadas. Consultá las observaciones de cada ficha antes de reutilizar sus datos.</p><p>La colección representa una captura del repositorio de origen, no un inventario exhaustivo ni una actualización en tiempo real. Los enlaces externos pueden cambiar.</p><h3>Tu selección</h3><p>Las tesis guardadas se almacenan solamente en este navegador. Podés exportar los resultados y compartir búsquedas mediante su dirección web.</p><div class="detail-actions"><a href="./data/catalog.json" download>Descargar catálogo</a><a href="./data/catalog.csv" download>Catálogo CSV</a></div>`,
  );
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportDialog() {
  if (!data || !rows.length) {
    toast("La colección debe cargarse antes de exportar.");
    return;
  }
  showDialog(
    `<h2 id="dialog-title">Exportar esta consulta</h2><p>${filtered.length} tesis con los filtros actuales. La exportación incluye identificadores, títulos, autores, año, nivel y áreas, junto con la dirección de esta consulta.</p><button data-export="json">Descargar JSON</button> <button data-export="csv">Descargar CSV</button>`,
  );
}
async function copy(v) {
  try {
    await navigator.clipboard.writeText(v);
    toast("Copiado al portapapeles");
  } catch {
    showDialog(
      `<h2 id="dialog-title">Copiar texto</h2><p>Seleccioná el texto para copiarlo.</p><textarea readonly style="width:100%;min-height:150px">${esc(v)}</textarea>`,
    );
  }
}
async function compareDialog() {
  const selection = [...compare]
    .map((id) => rows.find((r) => r.id === id))
    .filter(Boolean);
  showDialog(
    `<p class="eyebrow">LECTURA EN PARALELO</p><h2 id="dialog-title">Comparar tesis</h2><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">Campo</th>${selection.map((r) => `<th scope="col"><button data-open="${esc(r.id)}">${esc(r.title)}</button></th>`).join("")}</tr></thead><tbody>${[
      ["Autoría", "authors"],
      ["Año", "year"],
      ["Nivel", "level"],
      ["Área principal", "area"],
      ["Áreas secundarias", "secondary"],
      ["Palabras clave", "keywords"],
      ["Dirección", "directors"],
      ["Vista previa", "excerpt"],
    ]
      .map(
        ([label, key]) =>
          `<tr><th scope="row">${label}</th>${selection.map((r) => `<td>${esc(text(r[key]) || "Sin informar")}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`,
  );
}
function reset() {
  for (const k of ["query", "area", "level", "from", "to"])
    $("#" + k).value = "";
  $("#abstract").checked = $("#pdf").checked = false;
  savedOnly = false;
  writeState({ id: "" });
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.sourceDownload) {
    const parent = detailCache.get(b.dataset.sourceParent);
    const original = arr(parent?._publication?.sourceRecords).find(
      (r) => r.id === b.dataset.sourceDownload,
    );
    if (original)
      download(
        JSON.stringify(original, null, 2),
        "application/json",
        "registro-original-" + original.id.replaceAll("/", "_") + ".json",
      );
  }
  if (b.dataset.open) openDetail(b.dataset.open);
  if (b.dataset.save) {
    const id = b.dataset.save;
    saved.has(id) ? saved.delete(id) : saved.add(id);
    try {
      localStorage.setItem("fcm-saved", JSON.stringify([...saved]));
    } catch {
      toast(
        "La selección se conserva durante esta sesión; el almacenamiento no está disponible.",
      );
    }
    render();
    if ($("#dialog").open && selected === id) openDetail(id, false);
  }
  if (b.dataset.view) writeState({ view: b.dataset.view });
  if (b.hasAttribute("data-reset")) reset();
  if (b.dataset.retryDetail) openDetail(b.dataset.retryDetail, false);
  if (b.dataset.network) {
    writeState({ view: "network", id: b.dataset.network, open: "" });
    $("#visual").scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (b.hasAttribute("data-share")) copy(location.href);
  if (b.dataset.cite) {
    const r = rows.find((r) => r.id === b.dataset.cite),
      d = detailCache.get(r.id) || {};
    copy(
      `${text(r.authors) || "Autoría sin informar"}. (${r.year || "s. f."}). ${d.title_full || r.title} [${r.level || "Tesis"}]. ${text(d.grantor) || "Institución sin informar"}. ${safeUrl(arr(d.url)[0]) || r.id}`,
    );
  }
  if (b.dataset.export) {
    const out = filtered.map(
      ({ id, title, authors, year, level, area, secondary }) => ({
        id,
        title,
        authors,
        year,
        level,
        area,
        secondary,
      }),
    );
    if (b.dataset.export === "json")
      download(
        JSON.stringify(
          { query: location.href, snapshot: data.snapshot, rows: out },
          null,
          2,
        ),
        "application/json",
        "tesis-consulta.json",
      );
    else {
      const keys = [
        "id",
        "title",
        "authors",
        "year",
        "level",
        "area",
        "secondary",
      ];
      const cell = (v) =>
        '"' +
        text(v)
          .replace(/"/g, '""')
          .replace(/^[=+@-]/, "'$&") +
        '"';
      download(
        "\ufeff" +
          [
            keys.join(","),
            ...out.map((r) => keys.map((k) => cell(r[k])).join(",")),
          ].join("\r\n"),
        "text/csv;charset=utf-8",
        "tesis-consulta.csv",
      );
    }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.compare) {
    const id = e.target.dataset.compare;
    if (e.target.checked) {
      if (compare.size >= 3) {
        e.target.checked = false;
        toast("Podés comparar hasta tres tesis.");
        return;
      }
      compare.add(id);
    } else compare.delete(id);
    render();
  }
});
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  writeState({ id: "" });
});
for (const k of ["area", "level", "from", "to", "sort", "abstract", "pdf"])
  $("#" + k).addEventListener("change", () => writeState({ id: "" }));
$("#filter-toggle").onclick = () => {
  const open = $("#filter-toggle").getAttribute("aria-expanded") !== "true";
  $("#filter-toggle").setAttribute("aria-expanded", String(open));
  $("#filters").classList.toggle("filters-collapsed", !open);
  $("#filter-toggle").textContent = open
    ? "Ocultar filtros −"
    : "Refinar búsqueda y filtros ＋";
};
$("#clear").onclick = reset;
$("#saved").onclick = () => writeState({ saved: savedOnly ? "" : "1", id: "" });
for (const id of ["method", "method-footer"])
  $("#" + id).onclick = method;
$("#more").onclick = () => {
  limit += 24;
  render();
};
$("#export").onclick = exportDialog;
$("#compare").onclick = compareDialog;
$("#clearcompare").onclick = () => {
  compare.clear();
  render();
};
$("#close-dialog").onclick = () => $("#dialog").close();
$("#dialog").addEventListener("close", () => {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("open") === "1") {
    if (history.state?.modal) history.back();
    else {
      p.delete("open");
      history.replaceState(
        { ...history.state, modal: false },
        "",
        location.pathname + location.search + (p.size ? "#" + p : ""),
      );
      readState();
    }
  }
});
window.addEventListener("popstate", readState);
window.addEventListener("hashchange", () => {
  if (data) readState();
});
async function load() {
  try {
    const response = await fetch(
      new URL("../data/catalog.json", import.meta.url),
    );
    if (!response.ok) throw new Error("Catálogo no disponible");
    data = await response.json();
    if (!Array.isArray(data.rows)) throw new Error("Formato inválido");
    const searchResponse = await fetch(
      new URL("../data/search.json", import.meta.url),
    );
    if (!searchResponse.ok) throw new Error("Índice no disponible");
    const searchIndex = await searchResponse.json();
    rows = data.rows.map((r) => ({
      ...r,
      _areas: [...new Set([r.area, ...arr(r.secondary)].filter(Boolean))],
      _search: fold(
        searchIndex[r.id] ||
          [
            r.title,
            text(r.authors),
            text(r.keywords),
            text(r.subjects),
            text(r.directors),
            r.area,
            text(r.secondary),
            r.excerpt,
          ].join(" "),
      ),
    }));
    saved = new Set([...saved].map(canonicalId));
    updateFacets();
    readState();
  } catch {
    $("#count").textContent = "No pudimos cargar la colección";
    $("#results").setAttribute("aria-busy", "false");
    $("#results").innerHTML =
      '<div class="empty"><h3>La colección no está disponible.</h3><p>Comprobá la conexión y volvé a intentar.</p><button id="retry-load">Reintentar</button></div>';
    $("#retry-load").onclick = load;
  }
}
load();
