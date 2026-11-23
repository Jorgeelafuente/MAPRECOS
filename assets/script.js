
"use strict";

// MAPA V1.3 - GitHub Pages
// Compatible con el almacenamiento anterior

const STORAGE_KEY = "maprecos_clientes_v1";
const STATS_KEY = "maprecos_juegos_v12";
const CENTRO = [39.65, -0.35];

const $ = id => document.getElementById(id);

const TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const TILE_OPTIONS = {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
    'OpenStreetMap</a> contributors'
};

let clientes = [];
let referenciasMarcadores = new Map();

let clienteEditando = null;
let ubicacionTemporal = null;
let marcadorTemporal = null;
let seleccionandoPunto = false;
let importando = false;
let temporizadorToast = null;

let mapaJuego = null;
let capasJuego = null;
let sesion = null;

let estadisticas = {
  partidas: 0,
  aciertos: 0,
  record: 0,
  aprendizaje: {}
};

// ==========================================
// MAPA PRINCIPAL
// ==========================================

const mapa = L.map("map").setView(CENTRO, 9);

L.tileLayer(
  TILE_URL,
  TILE_OPTIONS
).addTo(mapa);

// ==========================================
// UTILIDADES
// ==========================================

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

function idNuevo() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function hayCoordenadas(c) {
  return Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180;
}

function clienteValido(c) {
  return c &&
    typeof c.id === "string" &&
    typeof c.nombre === "string" &&
    c.nombre.trim() !== "" &&
    typeof c.localidad === "string" &&
    typeof c.provincia === "string" &&
    (
      (c.lat === null && c.lng === null) ||
      hayCoordenadas(c)
    );
}

function avisar(mensaje) {
  $("toast").textContent = mensaje;
  $("toast").classList.remove("hidden");

  clearTimeout(temporizadorToast);

  temporizadorToast = setTimeout(() => {
    $("toast").classList.add("hidden");
  }, 3800);
}

function popupSeguro(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div;
}

function boton(texto, accion, clase = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texto;

  if (clase) b.className = clase;

  b.addEventListener("click", accion);
  return b;
}

function barajar(array) {
  const a = [...array];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function distanciaKm(a, b) {
  // Distancia geográfica en línea recta.
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) *
    Math.cos(b.lat * rad) *
    Math.sin(dLng / 2) ** 2;

  return 6371 * 2 *
    Math.asin(Math.min(1, Math.sqrt(h)));
}

function claveCliente(c) {
  return `${normalizar(c.nombre)}|${normalizar(c.localidad)}`;
}

// ==========================================
// ALMACENAMIENTO
// ==========================================

function leerDatos() {
  try {
    const guardados = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

    clientes = Array.isArray(guardados)
      ? guardados.filter(clienteValido).map(c => ({
          ...c,
          origen: c.origen || "manual"
        }))
      : [];

  } catch (error) {
    console.error(error);
    clientes = [];
    avisar("No se han podido leer los clientes guardados.");
  }

  try {
    const guardadas = JSON.parse(
      localStorage.getItem(STATS_KEY) || "null"
    );

    if (guardadas && typeof guardadas === "object") {
      estadisticas = {
        ...estadisticas,
        ...guardadas
      };

      if (
        !estadisticas.aprendizaje ||
        typeof estadisticas.aprendizaje !== "object"
      ) {
        estadisticas.aprendizaje = {};
      }
    }

  } catch (error) {
    console.warn("Estadísticas no disponibles", error);
  }

  refrescar();
}

function persistirClientes() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(clientes)
    );

    return true;

  } catch (error) {
    console.error(error);

    avisar(
      "No se pudieron guardar los cambios. " +
      "Exporta una copia de seguridad."
    );

    return false;
  }
}

function persistirEstadisticas() {
  try {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify(estadisticas)
    );
  } catch (error) {
    console.warn("No se guardaron las estadísticas", error);
  }
}

// ==========================================
// INTERFAZ DE CLIENTES
// ==========================================

function refrescar() {
  $("totalClientes").textContent = clientes.length;

  $("totalLocalidades").textContent = new Set(
    clientes
      .filter(c => c.localidad.trim())
      .map(c => normalizar(c.localidad))
  ).size;

  const ubicados = clientes.filter(
    hayCoordenadas
  ).length;

  $("totalUbicados").textContent = ubicados;

  $("totalPendientes").textContent =
    clientes.length - ubicados;

  refrescarLista();
  refrescarMarcadores();
  refrescarEstadisticas();
}

function refrescarLista() {
  const cont = $("listaClientes");

  const texto = normalizar(
    $("buscarCliente").value
  );

  const filtro = $("filtroClientes").value;

  cont.replaceChildren();

  const visibles = clientes.filter(c => {
    if (
      filtro === "ubicados" &&
      !hayCoordenadas(c)
    ) return false;

    if (
      filtro === "pendientes" &&
      hayCoordenadas(c)
    ) return false;

    return [
      c.nombre,
      c.localidad,
      c.provincia
    ].some(v => normalizar(v).includes(texto));

  }).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es")
  );

  if (!visibles.length) {
    const p = document.createElement("p");

    p.className = "empty";

    p.textContent = clientes.length
      ? "No hay resultados."
      : "Importa tu Excel o añade un cliente.";

    cont.appendChild(p);
    return;
  }

  visibles.forEach(c => {
    const item = document.createElement("div");

    item.className = "client-item" +
      (hayCoordenadas(c) ? "" : " pending");

    const nombre = document.createElement("div");
    nombre.className = "client-name";
    nombre.textContent = c.nombre;

    const donde = document.createElement("div");
    donde.className = "client-location";

    donde.textContent = hayCoordenadas(c)
      ? `📍 ${c.localidad || "Sin municipio"}`
      : `⚠️ Sin coordenadas · ${c.localidad || "Sin municipio"}`;

    const acciones = document.createElement("div");
    acciones.className = "client-actions";

    if (hayCoordenadas(c)) {
      acciones.appendChild(
        boton("Ver mapa", () => verCliente(c.id))
      );
    }

    acciones.appendChild(
      boton("Editar", () => abrirFormulario(c.id))
    );

    acciones.appendChild(
      boton(
        "Eliminar",
        () => eliminarCliente(c.id),
        "danger"
      )
    );

    item.append(nombre, donde, acciones);
    cont.appendChild(item);
  });
}

// ==========================================
// MARCADORES
// ==========================================

function iconoPunto(numero) {
  return L.divIcon({
    className: "client-pin",
    html:
      `<span class="pin-bubble${numero > 1 ? " multi" : ""}">` +
      `${numero > 1 ? numero : "•"}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -12]
  });
}

function refrescarMarcadores() {
  referenciasMarcadores.forEach(m =>
    mapa.removeLayer(m)
  );

  referenciasMarcadores.clear();

  const grupos = new Map();

  clientes.filter(hayCoordenadas).forEach(c => {
    const clave =
      `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;

    if (!grupos.has(clave)) {
      grupos.set(clave, []);
    }

    grupos.get(clave).push(c);
  });

  grupos.forEach(grupo => {
    const primero = grupo[0];

    const m = L.marker(
      [primero.lat, primero.lng],
      {icon: iconoPunto(grupo.length)}
    ).addTo(mapa);

    const contenido = document.createElement("div");

    const titulo = document.createElement("div");
    titulo.className = "popup-title";

    titulo.textContent =
      primero.localidad || "Clientes";

    const lista = document.createElement("ul");
    lista.className = "popup-list";

    grupo.forEach(c => {
      const li = document.createElement("li");
      li.textContent = c.nombre;

      lista.appendChild(li);

      referenciasMarcadores.set(c.id, m);
    });

    contenido.append(titulo, lista);

    m.bindPopup(contenido, {
      maxWidth: 290
    });
  });
}

function verCliente(id) {
  const c = clientes.find(x => x.id === id);

  if (!c || !hayCoordenadas(c)) return;

  mostrarVista("mapa");

  mapa.flyTo(
    [c.lat, c.lng],
    14,
    {duration: .7}
  );

  setTimeout(() => {
    referenciasMarcadores.get(id)?.openPopup();
  }, 750);
}

function verTodos() {
  const ubicados = clientes.filter(
    hayCoordenadas
  );

  if (!ubicados.length) {
    return mapa.setView(CENTRO, 9);
  }

  mapa.fitBounds(
    L.latLngBounds(
      ubicados.map(c => [c.lat, c.lng])
    ),
    {
      padding: [35, 35],
      maxZoom: 13
    }
  );
}

// ==========================================
// COORDENADAS DEL EXCEL
// ==========================================

function leerCoordenadas(valor) {
  if (
    valor === null ||
    valor === undefined ||
    !String(valor).trim()
  ) {
    return null;
  }

  const t = String(valor)
    .trim()
    .replace(/[º˚]/g, "°")
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"');

  // Formato:
  // 39°30'59.7"N 0°27'55.7"W

  const dms = [
    ...t.matchAll(
      /(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:[.,]\d+)?)\s*"?\s*([NSWE])/gi
    )
  ];

  if (dms.length === 2) {
    let lat = null;
    let lng = null;

    for (const p of dms) {
      const grados = Number(p[1]);
      const minutos = Number(p[2]);
      const segundos = Number(
        p[3].replace(",", ".")
      );

      const dir = p[4].toUpperCase();

      if (
        minutos >= 60 ||
        segundos >= 60 ||
        (["N", "S"].includes(dir) && grados > 90) ||
        (["E", "W"].includes(dir) && grados > 180)
      ) return null;

      let n =
        grados +
        minutos / 60 +
        segundos / 3600;

      if (dir === "S" || dir === "W") {
        n *= -1;
      }

      if (dir === "N" || dir === "S") {
        if (lat !== null) return null;
        lat = n;
      } else {
        if (lng !== null) return null;
        lng = n;
      }
    }

    return lat === null || lng === null
      ? null
      : {lat, lng};
  }

  // Coordenadas decimales separadas por ; o espacio

  const dec = t.match(
    /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[;\s]+\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/
  );

  if (dec) {
    const lat = Number(
      dec[1].replace(",", ".")
    );

    const lng = Number(
      dec[2].replace(",", ".")
    );

    if (hayCoordenadas({lat, lng})) {
      return {lat, lng};
    }
  }

  return null;
}

// ==========================================
// IMPORTAR EXCEL
// ==========================================

async function importarExcel(e) {
  const archivo = e.target.files[0];

  if (!archivo || importando) return;

  importando = true;

  $("btnExcel").disabled = true;
  $("btnExcel").textContent = "Leyendo Excel…";

  try {
    if (typeof XLSX === "undefined") {
      throw new Error(
        "No se cargó la librería para leer Excel."
      );
    }

    const libro = XLSX.read(
      await archivo.arrayBuffer(),
      {type: "array"}
    );

    const hoja = libro.SheetNames.find(
      n => normalizar(n) === "clientes"
    );

    if (!hoja) {
      throw new Error(
        "El archivo no tiene una pestaña CLIENTES."
      );
    }

    const filas = XLSX.utils.sheet_to_json(
      libro.Sheets[hoja],
      {
        header: 1,
        defval: "",
        blankrows: false
      }
    );

    const cab = (filas[0] || []).map(
      normalizar
    );

    const posNombre = cab.indexOf("cliente");
    const posMunicipio = cab.indexOf("municipio");
    const posProvincia = cab.indexOf("localidad");
    const posCoord = cab.indexOf("coordenadas");

    if (
      [posNombre, posMunicipio, posCoord].includes(-1)
    ) {
      throw new Error(
        "Faltan columnas CLIENTE, MUNICIPIO o COORDENADAS."
      );
    }

    const importados = [];
    const claves = new Set();

    filas.slice(1).forEach(f => {
      const nombre = String(
        f[posNombre] ?? ""
      ).trim();

      if (!nombre) return;

      const localidad = String(
        f[posMunicipio] ?? ""
      ).trim();

      const textoProv = posProvincia >= 0
        ? String(f[posProvincia] ?? "")
        : "";

      const provincia =
        normalizar(textoProv).includes("castellon")
          ? "Castellón"
          : "Valencia";

      const coords = leerCoordenadas(
        f[posCoord]
      );

      const c = {
        id: idNuevo(),
        nombre,
        localidad,
        provincia,
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        origen: "excel"
      };

      const clave = claveCliente(c);

      if (claves.has(clave)) return;

      claves.add(clave);
      importados.push(c);
    });

    if (!importados.length) {
      throw new Error(
        "No hay clientes para importar."
      );
    }

    const ubicados = importados.filter(
      hayCoordenadas
    ).length;

    const pendientes = importados.length - ubicados;

    const mensaje =
      `Detectados ${importados.length} clientes.\n` +
      `Ubicados: ${ubicados}\n` +
      `Pendientes: ${pendientes}\n\n` +
      "Se sustituirá la anterior importación Excel, " +
      "pero se mantendrán los clientes manuales. " +
      "¿Continuar?";

    if (!confirm(mensaje)) return;

    const manuales = clientes.filter(
      c => c.origen !== "excel"
    );

    const clavesManuales = new Set(
      manuales.map(claveCliente)
    );

    const nuevos = importados.filter(
      c => !clavesManuales.has(claveCliente(c))
    );

    const anterior = clientes;

    clientes = [
      ...manuales,
      ...nuevos
    ];

    if (!persistirClientes()) {
      clientes = anterior;
      return;
    }

    refrescar();
    verTodos();

    avisar(
      `Excel importado: ${nuevos.length} clientes. ` +
      `${pendientes} sin coordenadas en el archivo.`
    );

  } catch (error) {
    console.error(error);
    avisar(`Error al importar: ${error.message}`);

  } finally {
    e.target.value = "";
    importando = false;

    $("btnExcel").disabled = false;
    $("btnExcel").textContent = "📊 Importar clientes";
  }
}

// ==========================================
// AÑADIR Y EDITAR CLIENTES
// ==========================================

function abrirFormulario(id = null) {
  seleccionandoPunto = false;
  quitarPuntoTemporal();
  clienteEditando = id;

  $("formCliente").reset();

  const c = clientes.find(
    x => x.id === id
  );

  $("modalTitulo").textContent =
    c ? "Editar cliente" : "Añadir cliente";

  $("nombreCliente").value = c?.nombre || "";
  $("localidadCliente").value = c?.localidad || "";

  $("provinciaCliente").value =
    c?.provincia || "Valencia";

  ubicacionTemporal = c && hayCoordenadas(c)
    ? {lat: c.lat, lng: c.lng}
    : null;

  $("textoUbicacion").textContent = ubicacionTemporal
    ? `Posición actual: ${ubicacionTemporal.lat.toFixed(5)}, ${ubicacionTemporal.lng.toFixed(5)}`
    : "Sin posición. Puedes guardar el cliente pendiente y ubicarlo después.";

  $("modalCliente").classList.remove("hidden");
  $("nombreCliente").focus();
}

function quitarPuntoTemporal() {
  if (marcadorTemporal) {
    mapa.removeLayer(marcadorTemporal);
  }

  marcadorTemporal = null;
}

function cerrarFormulario() {
  $("modalCliente").classList.add("hidden");

  seleccionandoPunto = false;
  clienteEditando = null;
  ubicacionTemporal = null;

  quitarPuntoTemporal();

  mapa.getContainer().style.cursor = "";
  $("mapStatus").textContent = "Mapa preparado";
}

function definirUbicacion(lat, lng) {
  ubicacionTemporal = {lat, lng};

  $("textoUbicacion").textContent =
    `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  quitarPuntoTemporal();

  marcadorTemporal = L.circleMarker(
    [lat, lng],
    {
      radius: 10,
      weight: 3,
      color: "#b85e00",
      fillColor: "#ffb44e",
      fillOpacity: .9
    }
  ).addTo(mapa);
}

function buscarMunicipio() {
  // Búsqueda entre los clientes ya registrados.
  // No necesita geocodificación.

  const municipio = normalizar(
    $("localidadCliente").value
  );

  if (!municipio) {
    return avisar(
      "Escribe el municipio antes de buscar."
    );
  }

  const referencia = clientes.find(c =>
    normalizar(c.localidad) === municipio &&
    hayCoordenadas(c)
  );

  if (!referencia) {
    avisar(
      "Aún no hay clientes ubicados en ese municipio. " +
      "Localízalo moviendo el mapa."
    );
    return;
  }

  mapa.flyTo(
    [referencia.lat, referencia.lng],
    13
  );

  $("textoUbicacion").textContent =
    `Zona de ${referencia.localidad} localizada. ` +
    "Pulsa «Elegir en mapa» para colocar el nuevo cliente.";

  avisar(
    "Zona encontrada. Marca ahora el punto exacto en el mapa."
  );
}

function elegirEnMapa() {
  seleccionandoPunto = true;

  $("modalCliente").classList.add("hidden");

  mapa.getContainer().style.cursor = "crosshair";

  $("mapStatus").textContent =
    "Haz clic en la posición del cliente";

  avisar(
    "Pulsa el lugar del mapa donde quieras colocar el cliente."
  );
}

mapa.on("click", e => {
  if (!seleccionandoPunto) return;

  seleccionandoPunto = false;

  definirUbicacion(
    e.latlng.lat,
    e.latlng.lng
  );

  $("modalCliente").classList.remove("hidden");

  mapa.getContainer().style.cursor = "";
  $("mapStatus").textContent = "Ubicación seleccionada";
});

function guardarFormulario(e) {
  e.preventDefault();

  const nombre = $("nombreCliente").value.trim();

  if (!nombre) {
    return avisar(
      "Introduce el nombre del cliente."
    );
  }

  const localidad = $("localidadCliente").value.trim();
  const provincia = $("provinciaCliente").value;

  const anterior = clientes;
  const nuevos = [...clientes];

  if (clienteEditando) {
    const i = nuevos.findIndex(
      c => c.id === clienteEditando
    );

    if (i < 0) return;

    nuevos[i] = {
      ...nuevos[i],
      nombre,
      localidad,
      provincia,
      lat: ubicacionTemporal?.lat ?? null,
      lng: ubicacionTemporal?.lng ?? null,
      origen: "manual"
    };

  } else {
    nuevos.push({
      id: idNuevo(),
      nombre,
      localidad,
      provincia,
      lat: ubicacionTemporal?.lat ?? null,
      lng: ubicacionTemporal?.lng ?? null,
      origen: "manual"
    });
  }

  clientes = nuevos;

  if (!persistirClientes()) {
    clientes = anterior;
    return;
  }

  cerrarFormulario();
  refrescar();

  avisar("Cliente guardado correctamente.");
}

function eliminarCliente(id) {
  const c = clientes.find(x => x.id === id);

  if (!c) return;

  if (!confirm(
    `¿Eliminar el cliente ${c.nombre}?`
  )) return;

  const anterior = clientes;

  clientes = clientes.filter(
    x => x.id !== id
  );

  if (!persistirClientes()) {
    clientes = anterior;
    return;
  }

  refrescar();
  avisar("Cliente eliminado.");
}

// ==========================================
// COPIAS DE SEGURIDAD
// ==========================================

function exportarJSON() {
  const archivo = new Blob(
    [
      JSON.stringify({
        aplicacion: "MAPRECOS",
        version: 2,
        fecha: new Date().toISOString(),
        clientes
      }, null, 2)
    ],
    {
      type: "application/json"
    }
  );

  const url = URL.createObjectURL(archivo);
  const a = document.createElement("a");

  a.href = url;
  a.download = "clientes_mapa.json";
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  avisar("Copia de clientes exportada.");
}

async function importarJSON(e) {
  const archivo = e.target.files[0];

  if (!archivo) return;

  try {
    const contenido = JSON.parse(
      await archivo.text()
    );

    if (
      contenido.aplicacion !== "MAPRECOS" ||
      !Array.isArray(contenido.clientes) ||
      !contenido.clientes.every(clienteValido)
    ) {
      throw new Error("Formato incorrecto");
    }

    const ids = contenido.clientes.map(
      c => c.id
    );

    if (new Set(ids).size !== ids.length) {
      throw new Error("IDs duplicados");
    }

    if (!confirm(
      `¿Sustituir los clientes actuales por los ${ids.length} de la copia?`
    )) return;

    const anterior = clientes;

    clientes = contenido.clientes.map(c => ({
      ...c,
      origen: c.origen || "manual"
    }));

    if (!persistirClientes()) {
      clientes = anterior;
      return;
    }

    refrescar();
    verTodos();

    avisar("Copia restaurada correctamente.");

  } catch (error) {
    console.error(error);

    avisar(
      "No se ha podido importar el archivo JSON."
    );

  } finally {
    e.target.value = "";
  }
}

// ==========================================
// NAVEGACIÓN
// ==========================================

function mostrarVista(vista) {
  const esMapa = vista === "mapa";

  $("vistaMapa").classList.toggle(
    "hidden",
    !esMapa
  );

  $("vistaJuegos").classList.toggle(
    "hidden",
    esMapa
  );

  $("navMapa").classList.toggle(
    "active",
    esMapa
  );

  $("navJuegos").classList.toggle(
    "active",
    !esMapa
  );

  if (esMapa) {
    setTimeout(() => {
      mapa.invalidateSize();
    }, 80);
  } else {
    refrescarEstadisticas();
  }
}

function refrescarEstadisticas() {
  $("statsPartidas").textContent =
    estadisticas.partidas || 0;

  $("statsAciertos").textContent =
    estadisticas.aciertos || 0;

  $("statsRecord").textContent =
    estadisticas.record || 0;
}

// ==========================================
// MOTOR DE JUEGOS V1.3
// ==========================================

function detenerRelojes() {
  if (!sesion) return;

  if (sesion.relojIntervalo) {
    clearInterval(sesion.relojIntervalo);
  }

  if (sesion.espera) {
    clearTimeout(sesion.espera);
  }

  sesion.relojIntervalo = null;
  sesion.espera = null;
}

function volverCatalogo() {
  detenerRelojes();

  if (sesion) {
    sesion.activa = false;
  }

  sesion = null;

  $("partida").classList.add("hidden");
  $("catalogoJuegos").classList.remove("hidden");
  $("relojJuego").classList.add("hidden");

  refrescarEstadisticas();
}

// ==========================================
// SELECCIÓN DE PREGUNTAS
// ==========================================

function candidatosLocalidad() {
  // No preguntamos por nombres que aparecen
  // en municipios diferentes, para evitar
  // preguntas ambiguas.

  const nombres = new Map();

  clientes
    .filter(c => c.localidad.trim())
    .forEach(c => {
      const k = normalizar(c.nombre);

      if (!nombres.has(k)) {
        nombres.set(k, new Set());
      }

      nombres.get(k).add(
        normalizar(c.localidad)
      );
    });

  return clientes.filter(c =>
    c.localidad.trim() &&
    nombres.get(normalizar(c.nombre))?.size === 1
  );
}

function zonasElegibles() {
  const puntos = clientes.filter(
    hayCoordenadas
  );

  for (const radio of [8, 12, 20]) {
    const lista = puntos.filter(c => {
      let cerca = 0;
      let lejos = 0;

      puntos.forEach(x => {
        if (x.id === c.id) return;

        if (distanciaKm(c, x) <= radio) {
          cerca++;
        } else {
          lejos++;
        }
      });

      return cerca >= 1 && lejos >= 2;
    });

    if (lista.length) {
      return {radio, lista};
    }
  }

  return {
    radio: 12,
    lista: []
  };
}

function candidatosParejas() {
  return candidatosLocalidad();
}

function localidadesDistintas(lista) {
  return new Set(
    lista.map(c => normalizar(c.localidad))
  ).size;
}

function prioridadCliente(c) {
  const r =
    estadisticas.aprendizaje[claveCliente(c)] ||
    estadisticas.aprendizaje[c.id] ||
    {aciertos: 0, fallos: 0};

  return 1 + Math.max(
    0,
    (r.fallos || 0) - (r.aciertos || 0)
  );
}

function elegirCliente(lista) {
  if (!lista.length) return null;

  const peso = lista.reduce(
    (s, c) => s + prioridadCliente(c),
    0
  );

  let n = Math.random() * peso;

  for (const c of lista) {
    n -= prioridadCliente(c);

    if (n <= 0) {
      return c;
    }
  }

  return lista[lista.length - 1];
}

function sacarCliente(lista) {
  if (!sesion) return null;

  const sinRepetir = lista.filter(
    c => !sesion.usados.has(c.id)
  );

  const elegidos = sinRepetir.length
    ? sinRepetir
    : lista;

  const c = elegirCliente(elegidos);

  if (c) {
    sesion.usados.add(c.id);
  }

  return c;
}

function prepararParejas() {
  const candidatos = candidatosParejas();

  const localidadesUsadas = new Set();
  const elegidos = [];

  const sinRepetir = candidatos.filter(
    c => !sesion.usados.has(c.id)
  );

  const resto = [
    ...sinRepetir,
    ...candidatos.filter(c => sesion.usados.has(c.id))
  ];

  while (
    resto.length &&
    elegidos.length < 5
  ) {
    const c = elegirCliente(resto);

    resto.splice(
      resto.indexOf(c),
      1
    );

    const k = normalizar(c.localidad);

    if (!localidadesUsadas.has(k)) {
      localidadesUsadas.add(k);
      elegidos.push(c);
      sesion.usados.add(c.id);
    }
  }

  return elegidos;
}

// ==========================================
// INICIAR PARTIDAS
// ==========================================

function iniciarJuego(modo) {
  detenerRelojes();

  if (sesion) {
    sesion.activa = false;
  }

  const listaLoc = candidatosLocalidad();

  const listaCoord = clientes.filter(
    hayCoordenadas
  );

  const zona = zonasElegibles();

  const distintos = localidadesDistintas(
    listaLoc
  );

  if (
    ["localidad", "tiempo"].includes(modo) &&
    distintos < 2
  ) {
    return avisar(
      "Necesitas clientes de al menos dos municipios diferentes."
    );
  }

  if (
    modo === "zonas" &&
    !zona.lista.length
  ) {
    return avisar(
      "Para Domina las zonas necesitas clientes cercanos y otros alejados."
    );
  }

  if (
    modo === "ubicar" &&
    !listaCoord.length
  ) {
    return avisar(
      "Necesitas clientes con coordenadas para jugar en el mapa."
    );
  }

  if (
    modo === "parejas" &&
    distintos < 3
  ) {
    return avisar(
      "Para Une las parejas necesitas al menos tres municipios."
    );
  }

  if (
    modo === "final" &&
    (
      distintos < 4 ||
      listaCoord.length < 2 ||
      !zona.lista.length
    )
  ) {
    return avisar(
      "Para el Desafío final necesitas cuatro municipios, " +
      "clientes ubicados y zonas con vecinos."
    );
  }

  const planes = {
    localidad: Array(10).fill("localidad"),
    zonas: Array(10).fill("zonas"),
    ubicar: Array(10).fill("ubicar"),
    parejas: Array(3).fill("parejas"),
    tiempo: [],

    final: barajar([
      "localidad",
      "localidad",
      "localidad",
      "zonas",
      "zonas",
      "ubicar",
      "ubicar",
      "ubicar",
      "parejas",
      "parejas"
    ])
  };

  const nombres = {
    localidad: "Adivina la localidad",
    zonas: "Domina las zonas",
    ubicar: "Encuentra al cliente",
    tiempo: "Contrarreloj",
    parejas: "Une las parejas",
    final: "Desafío final"
  };

  sesion = {
    modo,
    plan: planes[modo],
    indice: 0,

    total: modo === "tiempo"
      ? null
      : planes[modo].length,

    puntos: 0,
    aciertos: 0,
    racha: 0,
    errores: 0,

    respondida: false,
    activa: true,

    usados: new Set(),
    numero: 0,
    pregunta: null,

    zona,
    listaLoc,
    listaCoord,

    tiempo: modo === "tiempo"
      ? 60
      : modo === "final"
        ? 180
        : null,

    fechaLimite: null,
    relojIntervalo: null,
    espera: null,

    puntoElegido: null,

    parejasElegidas: {
      cliente: null,
      municipio: null
    },

    parejasAcertadas: 0,
    erroresRonda: 0
  };

  $("nombreJuego").textContent =
    nombres[modo];

  $("catalogoJuegos").classList.add("hidden");
  $("partida").classList.remove("hidden");

  $("zonaPregunta").classList.remove("hidden");
  $("resumenJuego").classList.add("hidden");

  $("relojJuego").classList.toggle(
    "hidden",
    sesion.tiempo === null
  );

  nuevaPregunta();

  if (
    sesion &&
    sesion.tiempo !== null
  ) {
    arrancarReloj();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

// ==========================================
// TEMPORIZADOR
// ==========================================

function arrancarReloj() {
  const s = sesion;

  s.fechaLimite =
    Date.now() + s.tiempo * 1000;

  pintarReloj();

  s.relojIntervalo = setInterval(() => {
    if (
      sesion !== s ||
      !s.activa
    ) return;

    s.tiempo = Math.max(
      0,
      Math.ceil(
        (s.fechaLimite - Date.now()) / 1000
      )
    );

    pintarReloj();

    if (s.tiempo <= 0) {
      terminarJuego(true);
    }

  }, 200);
}

function pintarReloj() {
  if (
    !sesion ||
    sesion.tiempo === null
  ) return;

  const reloj = $("relojJuego");

  reloj.textContent =
    `⏱️ ${sesion.tiempo} s`;

  reloj.classList.toggle(
    "urgent",
    sesion.tiempo <= 15
  );

  if (sesion.modo === "tiempo") {
    $("barraProgreso").style.width =
      `${100 * sesion.tiempo / 60}%`;
  }
}

// ==========================================
// GENERACIÓN DE PREGUNTAS
// ==========================================

function tipoDePregunta() {
  return sesion.modo === "tiempo"
    ? "localidad"
    : sesion.plan[sesion.indice];
}

function nuevaPregunta() {
  const s = sesion;

  if (!s || !s.activa) return;

  if (
    s.total !== null &&
    s.indice >= s.total
  ) {
    return terminarJuego(false);
  }

  s.respondida = false;
  s.puntoElegido = null;
  s.numero++;

  s.erroresRonda = 0;
  s.parejasAcertadas = 0;

  s.parejasElegidas = {
    cliente: null,
    municipio: null
  };

  const tipo = tipoDePregunta();

  let q;

  if (tipo === "localidad") {
    q = preguntaLocalidad(
      sacarCliente(s.listaLoc)
    );

  } else if (tipo === "zonas") {
    q = preguntaZonas(
      sacarCliente(s.zona.lista),
      s.zona.radio
    );

  } else if (tipo === "ubicar") {
    q = preguntaUbicar(
      sacarCliente(s.listaCoord)
    );

  } else {
    q = preguntaParejas(
      prepararParejas()
    );
  }

  s.pregunta = q;

  $("respuestas").replaceChildren();
  $("tableroParejas").replaceChildren();

  $("tableroParejas").classList.add("hidden");
  $("respuestas").classList.remove("hidden");

  $("mapaJuegoWrap").classList.remove("locate");

  $("resultadoPregunta").className =
    "feedback hidden";

  $("btnSiguiente").classList.add("hidden");

  $("btnConfirmarZona").classList.toggle(
    "hidden",
    tipo !== "zonas"
  );

  $("btnConfirmarPunto").classList.toggle(
    "hidden",
    tipo !== "ubicar"
  );

  $("btnConfirmarPunto").disabled = true;

  $("textoPregunta").textContent = q.texto;
  $("ayudaPregunta").textContent = q.ayuda;

  $("rachaJuego").textContent =
    `Racha: ${s.racha}`;

  $("puntosJuego").textContent =
    `${s.puntos} puntos`;

  $("contadorPregunta").textContent =
    s.total === null
      ? `Pregunta ${s.indice + 1} · 60 segundos`
      : `Pregunta ${s.indice + 1} de ${s.total}`;

  if (s.modo !== "tiempo") {
    $("barraProgreso").style.width =
      `${100 * s.indice / s.total}%`;
  }

  if (tipo === "localidad") {
    mostrarOpcionesLocalidad(q);
  }

  if (tipo === "zonas") {
    mostrarOpcionesZonas(q);
  }

  if (tipo === "parejas") {
    mostrarTableroParejas(q);
  }

  if (
    tipo === "zonas" ||
    tipo === "ubicar"
  ) {
    dibujarMiniMapa(false);
  } else {
    $("mapaJuegoWrap").classList.add("hidden");
  }
}

// ==========================================
// PREGUNTA DE LOCALIDADES
// ==========================================

function preguntaLocalidad(c) {
  const otras = [
    ...new Map(
      sesion.listaLoc.map(
        x => [
          normalizar(x.localidad),
          x.localidad
        ]
      )
    ).values()
  ].filter(x =>
    normalizar(x) !== normalizar(c.localidad)
  );

  return {
    tipo: "localidad",
    objetivo: c,

    texto:
      `¿En qué localidad está ${c.nombre}?`,

    ayuda:
      "Elige el municipio correcto entre las opciones.",

    opciones: barajar([
      c.localidad,
      ...barajar(otras).slice(0, 3)
    ]),

    correcta: c.localidad
  };
}

// ==========================================
// PREGUNTA DE ZONAS
// ==========================================

function preguntaZonas(c, radio) {
  const puntos = sesion.listaCoord.filter(
    x => x.id !== c.id
  );

  const cerca = barajar(
    puntos.filter(
      x => distanciaKm(c, x) <= radio
    )
  ).slice(0, 3);

  const lejos = barajar(
    puntos.filter(
      x => distanciaKm(c, x) > radio
    )
  ).slice(0, 3);

  return {
    tipo: "zonas",
    objetivo: c,
    radio,

    texto:
      `¿Qué clientes están a ${radio} km o menos de ${c.nombre}?`,

    ayuda:
      "Selecciona todos los clientes cercanos de la lista. " +
      "La distancia es en línea recta.",

    opciones: barajar([
      ...cerca,
      ...lejos
    ]),

    correctos: new Set(
      cerca.map(x => x.id)
    )
  };
}

// ==========================================
// PREGUNTA DE UBICACIÓN
// ==========================================

function preguntaUbicar(c) {
  return {
    tipo: "ubicar",
    objetivo: c,

    texto: `¿Dónde está ${c.nombre}?`,

    ayuda:
      "Mueve el mapa y pulsa donde creas que está. " +
      "Confirma tu punto para ver cuántos kilómetros " +
      "te has equivocado."
  };
}

// ==========================================
// PREGUNTA DE PAREJAS
// ==========================================

function preguntaParejas(lista) {
  return {
    tipo: "parejas",
    pares: lista,

    texto:
      "Une cada cliente con su localidad",

    ayuda:
      "Pulsa primero un cliente y después su municipio. " +
      "Cada pareja correcta suma puntos."
  };
}

// ==========================================
// MOSTRAR OPCIONES
// ==========================================

function mostrarOpcionesLocalidad(q) {
  q.opciones.forEach(v => {
    const b = boton(
      v,
      () => responderLocalidad(v),
      "answer"
    );

    $("respuestas").appendChild(b);
  });
}

function mostrarOpcionesZonas(q) {
  q.opciones.forEach(c => {
    const etiqueta = document.createElement("label");
    etiqueta.className = "answer";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = c.id;

    input.style.width = "auto";
    input.style.marginRight = "9px";

    input.addEventListener("change", () => {
      etiqueta.classList.toggle(
        "selected",
        input.checked
      );
    });

    const texto = document.createElement("span");
    texto.textContent = c.nombre;

    etiqueta.append(input, texto);

    $("respuestas").appendChild(etiqueta);
  });
}

// ==========================================
// TABLERO DE PAREJAS
// ==========================================

function mostrarTableroParejas(q) {
  const tablero = $("tableroParejas");

  tablero.classList.remove("hidden");
  $("respuestas").classList.add("hidden");

  const izquierda = document.createElement("div");
  izquierda.className = "pairs-column";

  const derecha = document.createElement("div");
  derecha.className = "pairs-column";

  const t1 = document.createElement("div");
  const t2 = document.createElement("div");

  t1.className = "pairs-title";
  t2.className = "pairs-title";

  t1.textContent = "Clientes";
  t2.textContent = "Localidades";

  izquierda.appendChild(t1);
  derecha.appendChild(t2);

  barajar(q.pares).forEach(c => {
    const b = boton(
      c.nombre,
      () => elegirPareja("cliente", c, b),
      "pair-option"
    );

    izquierda.appendChild(b);
  });

  barajar(q.pares).forEach(c => {
    const b = boton(
      c.localidad,
      () => elegirPareja("municipio", c, b),
      "pair-option"
    );

    derecha.appendChild(b);
  });

  tablero.append(
    izquierda,
    derecha
  );

  const contador = document.createElement("p");
  contador.className = "pair-counter";
  contador.id = "contadorParejas";

  tablero.appendChild(contador);

  actualizarContadorParejas();
}

function actualizarContadorParejas() {
  const s = sesion;

  if (
    !s ||
    !$("contadorParejas")
  ) return;

  $("contadorParejas").textContent =
    `Parejas encontradas: ${s.parejasAcertadas}/${s.pregunta.pares.length}` +
    ` · Errores: ${s.erroresRonda}`;
}

// ==========================================
// JUEGO: UNE LAS PAREJAS
// ==========================================

function elegirPareja(lado, cliente, elemento) {
  const s = sesion;

  if (
    !s ||
    !s.activa ||
    s.respondida ||
    s.bloqueoParejas ||
    s.pregunta.tipo !== "parejas"
  ) return;

  const anterior =
    s.parejasElegidas[lado];

  if (anterior) {
    anterior.elemento.classList.remove("selected");
  }

  s.parejasElegidas[lado] = {
    cliente,
    elemento
  };

  elemento.classList.add("selected");

  const izq = s.parejasElegidas.cliente;
  const der = s.parejasElegidas.municipio;

  if (!izq || !der) return;

  const coinciden =
    normalizar(izq.cliente.localidad) ===
    normalizar(der.cliente.localidad);

  if (coinciden) {
    izq.elemento.classList.remove("selected");
    der.elemento.classList.remove("selected");

    izq.elemento.classList.add("matched");
    der.elemento.classList.add("matched");

    izq.elemento.disabled = true;
    der.elemento.disabled = true;

    s.parejasElegidas = {
      cliente: null,
      municipio: null
    };

    s.parejasAcertadas++;

    sumarAcierto(
      izq.cliente,
      75
    );

    actualizarContadorParejas();

    if (
      s.parejasAcertadas ===
      s.pregunta.pares.length
    ) {
      s.respondida = true;

      if (s.erroresRonda === 0) {
        s.aciertos++;
      }

      mostrarFeedback(
        true,
        `¡Tablero completado! ${s.parejasAcertadas} parejas. ` +
        (
          s.erroresRonda
            ? `Errores: ${s.erroresRonda}.`
            : "¡Sin errores!"
        )
      );

      cerrarPregunta();
    }

  } else {
    s.erroresRonda++;
    s.errores++;
    s.racha = 0;

    registrarAprendizaje(
      izq.cliente,
      false
    );

    s.puntos = Math.max(
      0,
      s.puntos - 10
    );

    actualizarPuntuacion();
    actualizarContadorParejas();

    s.bloqueoParejas = true;

    const numero = s.numero;

    s.espera = setTimeout(() => {
      if (
        sesion !== s ||
        !s.activa ||
        s.numero !== numero
      ) return;

      izq.elemento.classList.remove("selected");
      der.elemento.classList.remove("selected");

      s.parejasElegidas = {
        cliente: null,
        municipio: null
      };

      s.bloqueoParejas = false;

    }, 380);
  }
}

// ==========================================
// PROGRESO DE APRENDIZAJE
// ==========================================

function registrarAprendizaje(cliente, correcto) {
  const clave = claveCliente(cliente);

  const anterior =
    estadisticas.aprendizaje[clave] ||
    estadisticas.aprendizaje[cliente.id] ||
    {aciertos: 0, fallos: 0};

  const registro = {
    aciertos: Number(anterior.aciertos) || 0,
    fallos: Number(anterior.fallos) || 0
  };

  if (correcto) {
    registro.aciertos++;
  } else {
    registro.fallos++;
  }

  estadisticas.aprendizaje[clave] = registro;

  persistirEstadisticas();
}

function actualizarPuntuacion() {
  if (!sesion) return;

  $("puntosJuego").textContent =
    `${sesion.puntos} puntos`;

  $("rachaJuego").textContent =
    `Racha: ${sesion.racha}`;
}

function sumarAcierto(cliente, puntos) {
  if (
    !sesion ||
    !sesion.activa
  ) return;

  sesion.puntos += puntos;
  sesion.racha++;

  estadisticas.aciertos++;

  registrarAprendizaje(
    cliente,
    true
  );

  actualizarPuntuacion();
}

function registrarRonda(cliente, correcto, puntos) {
  if (
    !sesion ||
    !sesion.activa ||
    sesion.respondida
  ) return;

  sesion.respondida = true;

  if (correcto) {
    sesion.aciertos++;

    sumarAcierto(
      cliente,
      puntos
    );

  } else {
    sesion.puntos += puntos;
    sesion.racha = 0;
    sesion.errores++;

    registrarAprendizaje(
      cliente,
      false
    );

    actualizarPuntuacion();
  }

  cerrarPregunta();
}

function mostrarFeedback(bien, texto) {
  $("resultadoPregunta").className =
    `feedback ${bien ? "good" : "bad"}`;

  $("resultadoPregunta").textContent = texto;
}

function cerrarPregunta() {
  const s = sesion;

  if (!s) return;

  if (s.total !== null) {
    $("barraProgreso").style.width =
      `${100 * (s.indice + 1) / s.total}%`;
  }

  if (s.modo === "tiempo") {
    const numero = s.numero;

    s.espera = setTimeout(() => {
      if (
        sesion !== s ||
        !s.activa ||
        s.numero !== numero
      ) return;

      s.indice++;
      nuevaPregunta();

    }, 600);

  } else {
    $("btnSiguiente").textContent =
      (s.indice + 1 === s.total)
        ? "Ver resultados →"
        : "Siguiente pregunta →";

    $("btnSiguiente").classList.remove("hidden");
  }
}

// ==========================================
// JUEGO: ADIVINA LA LOCALIDAD
// ==========================================

function responderLocalidad(valor) {
  const s = sesion;

  if (
    !s ||
    !s.activa ||
    s.respondida
  ) return;

  const q = s.pregunta;

  const correcto =
    normalizar(valor) ===
    normalizar(q.correcta);

  const puntos = correcto
    ? 100 + Math.min(50, s.racha * 10)
    : 0;

  Array.from(
    $("respuestas").children
  ).forEach(b => {
    b.disabled = true;

    if (
      normalizar(b.textContent) ===
      normalizar(q.correcta)
    ) {
      b.classList.add("correct");

    } else if (
      normalizar(b.textContent) ===
      normalizar(valor)
    ) {
      b.classList.add("wrong");
    }
  });

  mostrarFeedback(
    correcto,
    correcto
      ? `¡Correcto! +${puntos} puntos.`
      : `Era ${q.correcta}. ${q.objetivo.nombre} está en ${q.correcta}.`
  );

  if (s.modo !== "tiempo") {
    dibujarMiniMapa(true);
  }

  registrarRonda(
    q.objetivo,
    correcto,
    puntos
  );
}

// ==========================================
// JUEGO: DOMINA LAS ZONAS
// ==========================================

function responderZonas() {
  const s = sesion;

  if (
    !s ||
    !s.activa ||
    s.respondida ||
    s.pregunta.tipo !== "zonas"
  ) return;

  const q = s.pregunta;

  const seleccionados = new Set(
    Array.from(
      $("respuestas").querySelectorAll("input:checked"),
      x => x.value
    )
  );

  const exacto =
    seleccionados.size === q.correctos.size &&
    [...q.correctos].every(
      id => seleccionados.has(id)
    );

  const hits = [...q.correctos].filter(
    id => seleccionados.has(id)
  ).length;

  const misses = [...seleccionados].filter(
    id => !q.correctos.has(id)
  ).length;

  const puntos = exacto
    ? 150 + Math.min(50, s.racha * 10)
    : Math.max(0, hits * 35 - misses * 20);

  Array.from(
    $("respuestas").querySelectorAll("label")
  ).forEach(etiqueta => {
    const input = etiqueta.querySelector("input");

    input.disabled = true;
    etiqueta.classList.remove("selected");

    if (q.correctos.has(input.value)) {
      etiqueta.classList.add("correct");

    } else if (seleccionados.has(input.value)) {
      etiqueta.classList.add("wrong");
    }
  });

  const nombres = q.opciones
    .filter(x => q.correctos.has(x.id))
    .map(x =>
      `${x.nombre} (${distanciaKm(q.objetivo, x).toFixed(1)} km)`
    );

  mostrarFeedback(
    exacto,
    `${exacto ? "¡Zona dominada!" : "Repasa estos vecinos."} +${puntos} puntos.\n` +
    `Las opciones cercanas eran: ${nombres.join(" · ")}.`
  );

  $("btnConfirmarZona").classList.add("hidden");

  dibujarMiniMapa(true);

  registrarRonda(
    q.objetivo,
    exacto,
    puntos
  );
}

// ==========================================
// JUEGO: ENCUENTRA AL CLIENTE
// ==========================================

function seleccionarPuntoJuego(e) {
  const s = sesion;

  if (
    !s ||
    !s.activa ||
    s.respondida ||
    s.pregunta.tipo !== "ubicar"
  ) return;

  s.puntoElegido = {
    lat: e.latlng.lat,
    lng: e.latlng.lng
  };

  $("btnConfirmarPunto").disabled = false;

  $("mapaJuegoTitulo").textContent =
    "Punto elegido. Puedes cambiarlo pulsando " +
    "otra ubicación o confirmar tu respuesta.";

  dibujarMiniMapa(false);
}

function responderUbicar() {
  const s = sesion;

  if (
    !s ||
    !s.activa ||
    s.respondida ||
    s.pregunta.tipo !== "ubicar" ||
    !s.puntoElegido
  ) return;

  const q = s.pregunta;

  const km = distanciaKm(
    s.puntoElegido,
    q.objetivo
  );

  const puntos =
    km <= 2 ? 200 :
    km <= 5 ? 150 :
    km <= 12 ? 100 :
    km <= 25 ? 50 : 0;

  const correcto = km <= 12;

  $("btnConfirmarPunto").classList.add("hidden");

  mostrarFeedback(
    correcto,
    `Te has quedado a ${km.toFixed(1)} km de ${q.objetivo.nombre} ` +
    `(${q.objetivo.localidad || "ubicación guardada"}). +${puntos} puntos.\n` +
    "El marcador verde indica la posición real; " +
    "el naranja, tu respuesta."
  );

  dibujarMiniMapa(true);

  registrarRonda(
    q.objetivo,
    correcto,
    puntos
  );
}

// ==========================================
// MAPAS DE LOS JUEGOS
// ==========================================

function obtenerMiniMapa() {
  if (!mapaJuego) {
    mapaJuego = L.map(
      "mapaJuego",
      {zoomControl: true}
    ).setView(CENTRO, 9);

    L.tileLayer(
      TILE_URL,
      TILE_OPTIONS
    ).addTo(mapaJuego);

    capasJuego = L.layerGroup().addTo(
      mapaJuego
    );

    mapaJuego.on(
      "click",
      seleccionarPuntoJuego
    );
  }

  return mapaJuego;
}

function dibujarMiniMapa(revelar) {
  const s = sesion;

  if (
    !s ||
    !s.activa
  ) return;

  const q = s.pregunta;

  const mostrar =
    q.tipo === "ubicar" ||
    q.tipo === "zonas" ||
    (
      q.tipo === "localidad" &&
      revelar &&
      s.modo !== "tiempo" &&
      hayCoordenadas(q.objetivo)
    );

  $("mapaJuegoWrap").classList.toggle(
    "hidden",
    !mostrar
  );

  if (!mostrar) return;

  $("mapaJuegoWrap").classList.toggle(
    "locate",
    q.tipo === "ubicar"
  );

  if (q.tipo === "zonas") {
    $("mapaJuegoTitulo").textContent =
      `Zona de ${q.objetivo.nombre}, radio ${q.radio} km.`;

  } else if (q.tipo === "localidad") {
    $("mapaJuegoTitulo").textContent =
      `Ubicación de ${q.objetivo.nombre} · ${q.objetivo.localidad}.`;

  } else if (!s.puntoElegido) {
    $("mapaJuegoTitulo").textContent =
      "Pulsa en el mapa donde creas que está " +
      "el cliente. Puedes hacer zoom.";
  }

  obtenerMiniMapa();

  const numero = s.numero;

  setTimeout(() => {
    if (
      sesion !== s ||
      !s.activa ||
      s.numero !== numero
    ) return;

    mapaJuego.invalidateSize();
    capasJuego.clearLayers();

    const c = q.objetivo;

    if (q.tipo === "localidad") {
      L.marker(
        [c.lat, c.lng]
      ).addTo(capasJuego).bindPopup(
        popupSeguro(`${c.nombre} · ${c.localidad}`)
      );

      mapaJuego.setView(
        [c.lat, c.lng],
        12
      );

    } else if (q.tipo === "zonas") {
      const circulo = L.circle(
        [c.lat, c.lng],
        {
          radius: q.radio * 1000,
          color: "#0078c8",
          fillColor: "#59b7e9",
          fillOpacity: .1,
          weight: 2
        }
      ).addTo(capasJuego);

      L.marker(
        [c.lat, c.lng]
      ).addTo(capasJuego).bindPopup(
        popupSeguro(`Referencia: ${c.nombre}`)
      );

      if (revelar) {
        q.opciones
          .filter(x => q.correctos.has(x.id))
          .forEach(x => {
            L.circleMarker(
              [x.lat, x.lng],
              {
                radius: 7,
                color: "white",
                weight: 2,
                fillColor: "#159867",
                fillOpacity: 1
              }
            ).addTo(capasJuego).bindPopup(
              popupSeguro(
                `${x.nombre} · ${distanciaKm(c, x).toFixed(1)} km`
              )
            );
          });
      }

      mapaJuego.fitBounds(
        circulo.getBounds(),
        {
          padding: [20, 20]
        }
      );

    } else if (q.tipo === "ubicar") {
      if (s.puntoElegido) {
        L.circleMarker(
          [
            s.puntoElegido.lat,
            s.puntoElegido.lng
          ],
          {
            radius: 9,
            color: "white",
            weight: 2,
            fillColor: "#e77d22",
            fillOpacity: 1
          }
        ).addTo(capasJuego).bindPopup(
          popupSeguro("Tu respuesta")
        );
      }

      if (revelar) {
        L.circleMarker(
          [c.lat, c.lng],
          {
            radius: 9,
            color: "white",
            weight: 2,
            fillColor: "#11945f",
            fillOpacity: 1
          }
        ).addTo(capasJuego).bindPopup(
          popupSeguro(
            `Ubicación real: ${c.nombre}`
          )
        );

        L.polyline(
          [
            [c.lat, c.lng],
            [
              s.puntoElegido.lat,
              s.puntoElegido.lng
            ]
          ],
          {
            color: "#ed7c21",
            weight: 3,
            dashArray: "6,7"
          }
        ).addTo(capasJuego);

        mapaJuego.fitBounds(
          L.latLngBounds([
            [c.lat, c.lng],
            [
              s.puntoElegido.lat,
              s.puntoElegido.lng
            ]
          ]),
          {
            padding: [35, 35],
            maxZoom: 12
          }
        );

      } else if (!s.puntoElegido) {
        const posiciones = s.listaCoord.map(
          x => [x.lat, x.lng]
        );

        mapaJuego.fitBounds(
          L.latLngBounds(posiciones),
          {
            padding: [15, 15],
            maxZoom: 10
          }
        );
      }
    }
  }, 85);
}

// ==========================================
// FINALIZAR PARTIDA
// ==========================================

function terminarJuego(porTiempo = false) {
  const s = sesion;

  if (
    !s ||
    !s.activa
  ) return;

  s.activa = false;

  detenerRelojes();

  estadisticas.partidas++;

  estadisticas.record = Math.max(
    Number(estadisticas.record) || 0,
    s.puntos
  );

  persistirEstadisticas();

  $("zonaPregunta").classList.add("hidden");
  $("relojJuego").classList.add("hidden");

  const resumen = $("resumenJuego");
  resumen.replaceChildren();
  resumen.classList.remove("hidden");

  const icono = document.createElement("div");
  icono.className = "medal";

  icono.textContent =
    s.aciertos >= Math.ceil(
      (s.total || (s.indice || 1)) * .8
    )
      ? "🏆"
      : "🎯";

  const titulo = document.createElement("h3");

  titulo.textContent = porTiempo
    ? "¡Tiempo terminado!"
    : "¡Partida terminada!";

  const puntuacion = document.createElement("div");
  puntuacion.className = "finish-score";
  puntuacion.textContent = `${s.puntos} puntos`;

  const detalle = document.createElement("p");

  const contador = s.total === null
    ? s.indice + (s.respondida ? 1 : 0)
    : s.total;

  detalle.textContent =
    `${s.aciertos} rondas perfectas de ${contador} completadas. ` +
    `${s.errores} errores. Los clientes que te cuestan ` +
    "volverán a aparecer en otras partidas.";

  const acciones = document.createElement("div");
  acciones.className = "finish-buttons";

  acciones.append(
    boton(
      "Volver a jugar",
      () => iniciarJuego(s.modo),
      "btn primary"
    ),
    boton(
      "Elegir otro juego",
      volverCatalogo,
      "btn secondary"
    )
  );

  resumen.append(
    icono,
    titulo,
    puntuacion,
    detalle,
    acciones
  );

  refrescarEstadisticas();
}

// ==========================================
// EVENTOS
// ==========================================

$("navMapa").addEventListener("click", () => {
  volverCatalogo();
  mostrarVista("mapa");
});

$("navJuegos").addEventListener(
  "click",
  () => mostrarVista("juegos")
);

$("btnNuevo").addEventListener(
  "click",
  () => abrirFormulario()
);

$("btnCerrar").addEventListener(
  "click",
  cerrarFormulario
);

$("modalCliente").addEventListener("click", e => {
  if (e.target === $("modalCliente")) {
    cerrarFormulario();
  }
});

$("formCliente").addEventListener(
  "submit",
  guardarFormulario
);

$("btnBuscarLocalidad").addEventListener(
  "click",
  buscarMunicipio
);

$("btnElegirMapa").addEventListener(
  "click",
  elegirEnMapa
);

$("buscarCliente").addEventListener(
  "input",
  refrescarLista
);

$("filtroClientes").addEventListener(
  "change",
  refrescarLista
);

$("btnCentrar").addEventListener(
  "click",
  verTodos
);

$("btnExcel").addEventListener("click", () => {
  $("archivoExcel").click();
});

$("archivoExcel").addEventListener(
  "change",
  importarExcel
);

$("btnExportar").addEventListener(
  "click",
  exportarJSON
);

$("btnImportar").addEventListener("click", () => {
  $("archivoImportar").click();
});

$("archivoImportar").addEventListener(
  "change",
  importarJSON
);

document.querySelectorAll("[data-juego]").forEach(b => {
  b.addEventListener(
    "click",
    () => iniciarJuego(b.dataset.juego)
  );
});

$("btnSalirPartida").addEventListener(
  "click",
  volverCatalogo
);

$("btnConfirmarZona").addEventListener(
  "click",
  responderZonas
);

$("btnConfirmarPunto").addEventListener(
  "click",
  responderUbicar
);

$("btnSiguiente").addEventListener("click", () => {
  if (
    !sesion ||
    !sesion.activa ||
    !sesion.respondida
  ) return;

  sesion.indice++;
  nuevaPregunta();
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;

  if (seleccionandoPunto) {
    seleccionandoPunto = false;

    $("modalCliente").classList.remove("hidden");
    mapa.getContainer().style.cursor = "";

  } else if (
    !$("modalCliente").classList.contains("hidden")
  ) {
    cerrarFormulario();
  }
});

// ==========================================
// INICIALIZACIÓN
// ==========================================

leerDatos();

setTimeout(() => {
  mapa.invalidateSize();

  if (clientes.some(hayCoordenadas)) {
    verTodos();
  }
}, 180);

console.log("MAPA V1.3 listo");
