
"use strict";

// MAPA V1.2 · GitHub Pages · Sin servidores propios
const STORAGE_KEY = "maprecos_clientes_v1";
const STATS_KEY = "maprecos_juegos_v12";
const CENTRO = [39.65, -0.35];
const $ = id => document.getElementById(id);

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
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

const mapa = L.map("map").setView(CENTRO, 9);
L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(mapa);

// ================================
// FUNCIONES COMUNES
// ================================

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
  // Distancia en línea recta, no por carretera.
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

// ================================
// ALMACENAMIENTO LOCAL
// ================================

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

// ================================
// ESTADÍSTICAS, LISTA Y MAPA
// ================================

function refrescar() {
  $("totalClientes").textContent = clientes.length;

  $("totalLocalidades").textContent = new Set(
    clientes
      .filter(c => c.localidad.trim())
      .map(c => normalizar(c.localidad))
  ).size;

  const ubicados = clientes.filter(hayCoordenadas).length;

  $("totalUbicados").textContent = ubicados;
  $("totalPendientes").textContent =
    clientes.length - ubicados;

  refrescarLista();
  refrescarMarcadores();
  refrescarEstadisticas();
}

function refrescarLista() {
  const cont = $("listaClientes");
  const texto = normalizar($("buscarCliente").value);
  const filtro = $("filtroClientes").value;

  cont.replaceChildren();

  const visibles = clientes.filter(c => {
    if (filtro === "ubicados" && !hayCoordenadas(c)) {
      return false;
    }

    if (filtro === "pendientes" && hayCoordenadas(c)) {
      return false;
    }

    return [c.nombre, c.localidad, c.provincia]
      .some(v => normalizar(v).includes(texto));

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
      boton("Eliminar", () => eliminarCliente(c.id), "danger")
    );

    item.append(nombre, donde, acciones);
    cont.appendChild(item);
  });
}

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
  referenciasMarcadores.forEach(m => {
    mapa.removeLayer(m);
  });

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
      { icon: iconoPunto(grupo.length) }
    ).addTo(mapa);

    const contenido = document.createElement("div");

    const titulo = document.createElement("div");
    titulo.className = "popup-title";
    titulo.textContent = primero.localidad || "Clientes";

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

  mapa.flyTo([c.lat, c.lng], 14, {
    duration: .7
  });

  setTimeout(() => {
    referenciasMarcadores.get(id)?.openPopup();
  }, 750);
}

function verTodos() {
  const ubicados = clientes.filter(hayCoordenadas);

  if (!ubicados.length) {
    mapa.setView(CENTRO, 9);
    return;
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

// ================================
// COORDENADAS DEL EXCEL
// ================================

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

  // Formato Google Maps:
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
      ) {
        return null;
      }

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
      : { lat, lng };
  }

  // También admite coordenadas decimales.

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

// ================================
// IMPORTACIÓN DEL EXCEL
// ================================

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
      { type: "array" }
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

    const cab = (filas[0] || []).map(normalizar);

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

    clientes = [...manuales, ...nuevos];

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

// ================================
// AÑADIR Y EDITAR CLIENTES
// ================================

function abrirFormulario(id = null) {
  seleccionandoPunto = false;
  quitarPuntoTemporal();
  clienteEditando = id;

  $("formCliente").reset();

  const c = clientes.find(x => x.id === id);

  $("modalTitulo").textContent =
    c ? "Editar cliente" : "Añadir cliente";

  $("nombreCliente").value = c?.nombre || "";
  $("localidadCliente").value = c?.localidad || "";
  $("provinciaCliente").value = c?.provincia || "Valencia";

  ubicacionTemporal = c && hayCoordenadas(c)
    ? { lat: c.lat, lng: c.lng }
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
  ubicacionTemporal = { lat, lng };

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
  // Búsqueda local entre clientes ya registrados.
  // No utiliza servicios de geocodificación.

  const municipio = normalizar(
    $("localidadCliente").value
  );

  if (!municipio) {
    return avisar(
      "Escribe el municipio antes de buscar."
    );
  }

  const referencia = clientes.find(
    c =>
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

      // Las correcciones manuales se conservan
      // cuando vuelvas a importar un Excel.
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
  )) {
    return;
  }

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

// ================================
// COPIAS DE SEGURIDAD
// ================================

function exportarJSON() {
  const archivo = new Blob(
    [
      JSON.stringify(
        {
          aplicacion: "MAPRECOS",
          version: 2,
          fecha: new Date().toISOString(),
          clientes
        },
        null,
        2
      )
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
    )) {
      return;
    }

    const anterior = clientes;

    clientes = contenido.clientes.map(
      c => ({
        ...c,
        origen: c.origen || "manual"
      })
    );

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

// ================================
// PANTALLAS
// ================================

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

function volverCatalogo() {
  sesion = null;

  $("partida").classList.add("hidden");
  $("catalogoJuegos").classList.remove("hidden");

  refrescarEstadisticas();
}

// ================================
// JUEGOS: CONFIGURACIÓN
// ================================

function candidatosOrdenados(lista) {
  // Los clientes fallados aparecerán
  // con mayor frecuencia en nuevas partidas.

  return lista.map(c => {
    const r = estadisticas.aprendizaje[c.id] || {
      aciertos: 0,
      fallos: 0
    };

    return {
      c,
      orden:
        Math.random() /
        (
          1 + Math.max(
            0,
            r.fallos - r.aciertos
          )
        )
    };

  }).sort((a, b) =>
    a.orden - b.orden
  ).map(x => x.c);
}

function iniciarJuego(tipo) {
  let candidatos = [];
  let radio = 12;

  if (tipo === "localidad") {
    candidatos = clientes.filter(
      c => c.localidad.trim()
    );

    const localidades = new Set(
      candidatos.map(
        c => normalizar(c.localidad)
      )
    );

    if (
      candidatos.length < 2 ||
      localidades.size < 2
    ) {
      return avisar(
        "Necesitas clientes de al menos dos municipios para jugar."
      );
    }

  } else {
    const puntos = clientes.filter(
      hayCoordenadas
    );

    // Buscamos un radio con grupos de clientes
    // y con suficientes opciones más lejanas.

    for (const r of [8, 12, 20]) {
      const elegibles = puntos.filter(c => {
        const proximos = puntos.filter(
          x =>
            x.id !== c.id &&
            distanciaKm(c, x) <= r
        );

        const lejanos = puntos.filter(
          x =>
            x.id !== c.id &&
            distanciaKm(c, x) > r
        );

        return proximos.length >= 1 &&
          lejanos.length >= 2;
      });

      if (elegibles.length) {
        candidatos = elegibles;
        radio = r;
        break;
      }
    }

    if (!candidatos.length) {
      return avisar(
        "Para jugar por zonas necesitas clientes " +
        "ubicados cerca y otros más alejados."
      );
    }
  }

  sesion = {
    tipo,
    radio,
    candidatos: candidatosOrdenados(candidatos),
    indice: 0,
    total: Math.min(10, candidatos.length),
    puntos: 0,
    aciertos: 0,
    racha: 0,
    pregunta: null,
    respondida: false
  };

  $("catalogoJuegos").classList.add("hidden");
  $("partida").classList.remove("hidden");
  $("zonaPregunta").classList.remove("hidden");
  $("resumenJuego").classList.add("hidden");

  $("nombreJuego").textContent =
    tipo === "localidad"
      ? "Adivina la localidad"
      : "Domina las zonas";

  siguientePregunta();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

// ================================
// GENERADOR DE PREGUNTAS
// ================================

function siguientePregunta() {
  if (!sesion) return;

  if (sesion.indice >= sesion.total) {
    return terminarJuego();
  }

  sesion.respondida = false;

  const objetivo =
    sesion.candidatos[sesion.indice];

  sesion.pregunta =
    sesion.tipo === "localidad"
      ? crearPreguntaLocalidad(objetivo)
      : crearPreguntaZonas(
          objetivo,
          sesion.radio
        );

  $("contadorPregunta").textContent =
    `Pregunta ${sesion.indice + 1} de ${sesion.total}`;

  $("rachaJuego").textContent =
    `Racha: ${sesion.racha}`;

  $("puntosJuego").textContent =
    `${sesion.puntos} puntos`;

  $("barraProgreso").style.width =
    `${sesion.indice / sesion.total * 100}%`;

  $("resultadoPregunta").className =
    "feedback hidden";

  $("btnSiguiente").classList.add("hidden");

  $("btnConfirmarZona").classList.toggle(
    "hidden",
    sesion.tipo !== "zonas"
  );

  $("textoPregunta").textContent =
    sesion.pregunta.texto;

  $("ayudaPregunta").textContent =
    sesion.pregunta.ayuda;

  representarOpciones();

  if (sesion.tipo === "zonas") {
    dibujarMiniMapa(false);
  } else {
    $("mapaJuegoWrap").classList.add("hidden");
  }
}

// ================================
// JUEGO 1: ADIVINA LA LOCALIDAD
// ================================

function crearPreguntaLocalidad(c) {
  const distintas = [
    ...new Map(
      clientes
        .filter(x => x.localidad.trim())
        .map(x => [
          normalizar(x.localidad),
          x.localidad
        ])
    ).values()
  ];

  const distractores = barajar(
    distintas.filter(
      x =>
        normalizar(x) !== normalizar(c.localidad)
    )
  ).slice(0, 3);

  return {
    objetivo: c,
    texto: `¿En qué localidad está ${c.nombre}?`,
    ayuda:
      "Selecciona una respuesta. Después podrás " +
      "comprobar su posición en el mapa.",
    opciones: barajar([
      c.localidad,
      ...distractores
    ]),
    correcta: c.localidad
  };
}

// ================================
// JUEGO 2: DOMINA LAS ZONAS
// ================================

function crearPreguntaZonas(c, radio) {
  const puntos = clientes.filter(
    x =>
      hayCoordenadas(x) &&
      x.id !== c.id
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

  const opciones = barajar([
    ...cerca,
    ...lejos
  ]);

  return {
    objetivo: c,
    radio,
    texto:
      `¿Qué clientes están a ${radio} km o menos de ${c.nombre}?`,
    ayuda:
      "Marca todos los clientes cercanos entre estas opciones. " +
      "Distancia en línea recta, no por carretera.",
    opciones,
    correctos: new Set(
      cerca.map(x => x.id)
    )
  };
}

// ================================
// MOSTRAR RESPUESTAS
// ================================

function representarOpciones() {
  const cont = $("respuestas");
  cont.replaceChildren();

  const q = sesion.pregunta;

  if (sesion.tipo === "localidad") {
    q.opciones.forEach(op => {
      const b = boton(
        op,
        () => responderLocalidad(op, b),
        "answer"
      );

      b.dataset.valor = normalizar(op);
      cont.appendChild(b);
    });

  } else {
    q.opciones.forEach(c => {
      const label = document.createElement("label");
      label.className = "answer";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.value = c.id;
      check.style.width = "auto";
      check.style.marginRight = "9px";

      check.addEventListener("change", () => {
        label.classList.toggle(
          "selected",
          check.checked
        );
      });

      const span = document.createElement("span");
      span.textContent =
        `${c.nombre} · ${c.localidad || "Sin municipio"}`;

      label.append(check, span);
      cont.appendChild(label);
    });
  }
}

// ================================
// PUNTUACIÓN Y PROGRESO
// ================================

function apuntarResultado(cliente, correcto, puntos) {
  if (!sesion || sesion.respondida) return;

  sesion.respondida = true;
  sesion.puntos += puntos;

  if (correcto) {
    sesion.aciertos++;
    sesion.racha++;
    estadisticas.aciertos++;
  } else {
    sesion.racha = 0;
  }

  const registro =
    estadisticas.aprendizaje[cliente.id] || {
      aciertos: 0,
      fallos: 0
    };

  if (correcto) {
    registro.aciertos++;
  } else {
    registro.fallos++;
  }

  estadisticas.aprendizaje[cliente.id] =
    registro;

  persistirEstadisticas();

  $("puntosJuego").textContent =
    `${sesion.puntos} puntos`;

  $("rachaJuego").textContent =
    `Racha: ${sesion.racha}`;

  $("btnSiguiente").textContent =
    sesion.indice + 1 === sesion.total
      ? "Ver resultados →"
      : "Siguiente pregunta →";

  $("btnSiguiente").classList.remove("hidden");

  $("barraProgreso").style.width =
    `${(sesion.indice + 1) / sesion.total * 100}%`;
}

// ================================
// COMPROBAR JUEGO 1
// ================================

function responderLocalidad(valor) {
  if (!sesion || sesion.respondida) return;

  const q = sesion.pregunta;

  const acierto =
    normalizar(valor) === normalizar(q.correcta);

  const puntos = acierto
    ? 100 + Math.min(50, sesion.racha * 10)
    : 0;

  [...$("respuestas").children].forEach(b => {
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
    acierto,
    acierto
      ? `¡Correcto! +${puntos} puntos.`
      : `Respuesta correcta: ${q.correcta}.`
  );

  dibujarMiniMapa(true);

  apuntarResultado(
    q.objetivo,
    acierto,
    puntos
  );
}

// ================================
// COMPROBAR JUEGO 2
// ================================

function responderZonas() {
  if (!sesion || sesion.respondida) return;

  const q = sesion.pregunta;

  const seleccionados = new Set(
    [
      ...$("respuestas").querySelectorAll(
        "input:checked"
      )
    ].map(x => x.value)
  );

  const exacto =
    seleccionados.size === q.correctos.size &&
    [...q.correctos].every(
      id => seleccionados.has(id)
    );

  const aciertos = [...q.correctos].filter(
    id => seleccionados.has(id)
  ).length;

  const fallos = [...seleccionados].filter(
    id => !q.correctos.has(id)
  ).length;

  const puntos = exacto
    ? 150 + Math.min(50, sesion.racha * 10)
    : Math.max(
        0,
        aciertos * 35 - fallos * 20
      );

  [
    ...$("respuestas").querySelectorAll("label")
  ].forEach(label => {
    const input = label.querySelector("input");

    input.disabled = true;

    label.classList.remove("selected");

    if (q.correctos.has(input.value)) {
      label.classList.add("correct");

    } else if (seleccionados.has(input.value)) {
      label.classList.add("wrong");
    }
  });

  const nombres = q.opciones
    .filter(x => q.correctos.has(x.id))
    .map(
      x =>
        `${x.nombre} (${distanciaKm(q.objetivo, x).toFixed(1)} km)`
    );

  mostrarFeedback(
    exacto,
    (
      exacto
        ? "¡Zona dominada!"
        : "Repasemos los clientes cercanos."
    ) +
    ` +${puntos} puntos.\n` +
    `Entre las opciones, a ${q.radio} km o menos: ` +
    `${nombres.join(" · ")}.`
  );

  $("btnConfirmarZona").classList.add("hidden");

  dibujarMiniMapa(true);

  apuntarResultado(
    q.objetivo,
    exacto,
    puntos
  );
}

function mostrarFeedback(bien, mensaje) {
  const panel = $("resultadoPregunta");

  panel.className =
    `feedback ${bien ? "good" : "bad"}`;

  panel.textContent = mensaje;
}

// ================================
// MAPA INTERACTIVO DE LOS JUEGOS
// ================================

function obtenerMiniMapa() {
  if (!mapaJuego) {
    mapaJuego = L.map(
      "mapaJuego",
      {zoomControl: true}
    ).setView(CENTRO, 10);

    L.tileLayer(
      TILE_URL,
      TILE_OPTIONS
    ).addTo(mapaJuego);

    capasJuego = L.layerGroup().addTo(
      mapaJuego
    );
  }

  return mapaJuego;
}

function dibujarMiniMapa(revelar) {
  const q = sesion.pregunta;

  const mostrar =
    sesion.tipo === "zonas" || revelar;

  $("mapaJuegoWrap").classList.toggle(
    "hidden",
    !mostrar
  );

  if (!mostrar) return;

  $("mapaJuegoTitulo").textContent =
    sesion.tipo === "zonas"
      ? `Zona de ${q.objetivo.nombre}: radio de ${q.radio} km en línea recta.`
      : `Ubicación de ${q.objetivo.nombre} en ${q.objetivo.localidad}.`;

  obtenerMiniMapa();

  setTimeout(() => {
    if (!sesion) return;

    mapaJuego.invalidateSize();
    capasJuego.clearLayers();

    const c = q.objetivo;

    if (sesion.tipo === "localidad") {
      if (hayCoordenadas(c)) {
        L.marker(
          [c.lat, c.lng]
        ).addTo(capasJuego).bindPopup(
          popupSeguro(c.nombre)
        );

        mapaJuego.setView(
          [c.lat, c.lng],
          12
        );

      } else {
        mapaJuego.setView(CENTRO, 9);

        $("mapaJuegoTitulo").textContent =
          "Este cliente no tiene coordenadas GPS guardadas.";
      }

    } else {
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
          .filter(
            x => q.correctos.has(x.id)
          )
          .forEach(x => {
            L.circleMarker(
              [x.lat, x.lng],
              {
                radius: 7,
                color: "#ffffff",
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
          padding: [15, 15]
        }
      );
    }
  }, 90);
}

// ================================
// FINAL DE LA PARTIDA
// ================================

function terminarJuego() {
  if (!sesion) return;

  const tipo = sesion.tipo;

  estadisticas.partidas++;

  estadisticas.record = Math.max(
    estadisticas.record || 0,
    sesion.puntos
  );

  persistirEstadisticas();

  $("zonaPregunta").classList.add("hidden");

  const resumen = $("resumenJuego");

  resumen.classList.remove("hidden");
  resumen.replaceChildren();

  const medalla = document.createElement("div");
  medalla.className = "medal";
  medalla.textContent =
    sesion.aciertos >= Math.ceil(sesion.total * .8)
      ? "🏆"
      : "🎯";

  const titulo = document.createElement("h3");
  titulo.textContent = "¡Partida terminada!";

  const detalle = document.createElement("p");
  detalle.textContent =
    `${sesion.aciertos} de ${sesion.total} rondas perfectas · ` +
    `${sesion.puntos} puntos. ` +
    "Los clientes que falles tendrán más posibilidades " +
    "de aparecer en próximas partidas.";

  const acciones = document.createElement("div");
  acciones.className = "finish-buttons";

  acciones.append(
    boton(
      "Volver a jugar",
      () => iniciarJuego(tipo),
      "btn primary"
    ),
    boton(
      "Elegir otro juego",
      volverCatalogo,
      "btn secondary"
    )
  );

  resumen.append(
    medalla,
    titulo,
    detalle,
    acciones
  );

  refrescarEstadisticas();
}

// ================================
// EVENTOS
// ================================

$("navMapa").addEventListener(
  "click",
  () => mostrarVista("mapa")
);

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

$("modalCliente").addEventListener(
  "click",
  e => {
    if (e.target === $("modalCliente")) {
      cerrarFormulario();
    }
  }
);

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

$("btnExcel").addEventListener(
  "click",
  () => $("archivoExcel").click()
);

$("archivoExcel").addEventListener(
  "change",
  importarExcel
);

$("btnExportar").addEventListener(
  "click",
  exportarJSON
);

$("btnImportar").addEventListener(
  "click",
  () => $("archivoImportar").click()
);

$("archivoImportar").addEventListener(
  "change",
  importarJSON
);

document.querySelectorAll("[data-juego]").forEach(
  b => {
    b.addEventListener(
      "click",
      () => iniciarJuego(b.dataset.juego)
    );
  }
);

$("btnSalirPartida").addEventListener(
  "click",
  volverCatalogo
);

$("btnConfirmarZona").addEventListener(
  "click",
  responderZonas
);

$("btnSiguiente").addEventListener(
  "click",
  () => {
    if (!sesion || !sesion.respondida) return;

    sesion.indice++;
    siguientePregunta();
  }
);

document.addEventListener(
  "keydown",
  e => {
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
  }
);

// ================================
// INICIO
// ================================

leerDatos();

setTimeout(() => {
  mapa.invalidateSize();

  if (clientes.some(hayCoordenadas)) {
    verTodos();
  }
}, 180);

console.log("MAPA V1.2 listo");
