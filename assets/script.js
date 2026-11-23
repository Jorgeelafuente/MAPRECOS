
"use strict";

// MAPA DE CLIENTES - V1.1

const STORAGE_KEY = "maprecos_clientes_v1";
const CENTRO = [39.65, -0.35];
const ZOOM_INICIAL = 9;

const $ = id => document.getElementById(id);

let clientes = [];
let marcadores = new Map();
let clienteEditando = null;
let ubicacionTemporal = null;
let marcadorTemporal = null;
let seleccionandoMapa = false;
let toastTimer = null;
let importacionExcelEnCurso = false;

// ============================
// MAPA SATÉLITE
// ============================

const mapa = L.map("map").setView(
  CENTRO,
  ZOOM_INICIAL
);


L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">' +
      'OpenStreetMap</a> contributors'
  }
).addTo(mapa);


// Marcadores
const iconoCliente = L.divIcon({
  className: "custom-marker",
  html: `
    <div style="
      width:28px;
      height:28px;
      background:#0078c8;
      border:3px solid white;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 3px 8px #0007;
      display:flex;
      align-items:center;
      justify-content:center;
    ">
      <span style="
        transform:rotate(45deg);
        color:white;
        font-size:13px;
      ">●</span>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28]
});

// ============================
// UTILIDADES
// ============================

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function generarId() {
  if (window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return Date.now().toString(36) +
    Math.random().toString(36).slice(2);
}

function tieneCoordenadas(c) {
  return Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    c.lat >= -90 && c.lat <= 90 &&
    c.lng >= -180 && c.lng <= 180;
}

function validarCliente(c) {
  return c &&
    typeof c.id === "string" &&
    typeof c.nombre === "string" &&
    c.nombre.trim().length > 0 &&
    typeof c.localidad === "string" &&
    typeof c.provincia === "string" &&
    (c.lat === null && c.lng === null ||
      tieneCoordenadas(c));
}

function mostrarToast(mensaje) {
  const toast = $("toast");
  toast.textContent = mensaje;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

// ============================
// ALMACENAMIENTO
// ============================

function cargarClientes() {
  try {
    const datos = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

    clientes = Array.isArray(datos)
      ? datos.filter(validarCliente).map(c => ({
          ...c,
          origen: c.origen || "manual"
        }))
      : [];

  } catch (error) {
    console.error(error);
    clientes = [];
    mostrarToast("Error al leer los datos guardados.");
  }

  actualizarInterfaz();
}

function guardarClientes() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(clientes)
    );
    return true;
  } catch (error) {
    console.error(error);
    mostrarToast("No se pudieron guardar los datos.");
    return false;
  }
}

// ============================
// CONVERTIR COORDENADAS
// ============================

// Ejemplo:
// 39°30'59.7"N 0°27'55.7"W
// Se convierte a latitud y longitud decimal.

function convertirCoordenadas(valor) {
  if (valor === null || valor === undefined) {
    return null;
  }

  const texto = String(valor).trim()
    .replace(/[º˚]/g, "°")
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/,/g, ".");

  if (!texto) return null;

  const patron =
    /(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*"?\s*([NSWE])/gi;

  const partes = [...texto.matchAll(patron)];

  if (partes.length !== 2) return null;

  let lat = null;
  let lng = null;

  for (const p of partes) {
    const grados = Number(p[1]);
    const minutos = Number(p[2]);
    const segundos = Number(p[3]);
    const direccion = p[4].toUpperCase();

    if (
      minutos >= 60 ||
      segundos >= 60 ||
      (["N", "S"].includes(direccion) && grados > 90) ||
      (["E", "W"].includes(direccion) && grados > 180)
    ) {
      return null;
    }

    let decimal =
      grados + minutos / 60 + segundos / 3600;

    if (direccion === "S" || direccion === "W") {
      decimal *= -1;
    }

    if (direccion === "N" || direccion === "S") {
      if (lat !== null) return null;
      lat = decimal;
    } else {
      if (lng !== null) return null;
      lng = decimal;
    }
  }

  if (lat === null || lng === null) return null;

  return { lat, lng };
}

// ============================
// IMPORTACIÓN EXCEL
// ============================

async function importarExcel(evento) {
  const archivo = evento.target.files[0];
  if (!archivo || importacionExcelEnCurso) return;

  importacionExcelEnCurso = true;
  $("btnExcel").disabled = true;
  $("btnExcel").textContent = "Leyendo Excel...";

  try {
    if (typeof XLSX === "undefined") {
      throw new Error("No se ha cargado la librería Excel");
    }

    const buffer = await archivo.arrayBuffer();

    const libro = XLSX.read(buffer, {
      type: "array"
    });

    const nombreHoja = libro.SheetNames.find(
      n => normalizar(n) === "clientes"
    );

    if (!nombreHoja) {
      throw new Error(
        "El Excel no contiene la pestaña CLIENTES"
      );
    }

    const filas = XLSX.utils.sheet_to_json(
      libro.Sheets[nombreHoja],
      {
        header: 1,
        defval: "",
        blankrows: false
      }
    );

    if (filas.length < 2) {
      throw new Error("La pestaña CLIENTES está vacía");
    }

    const cabeceras = filas[0].map(normalizar);

    const indiceNombre = cabeceras.indexOf("cliente");
    const indiceMunicipio = cabeceras.indexOf("municipio");
    const indiceProvincia = cabeceras.indexOf("localidad");
    const indiceCoords = cabeceras.indexOf("coordenadas");

    if (
      indiceNombre === -1 ||
      indiceMunicipio === -1 ||
      indiceCoords === -1
    ) {
      throw new Error(
        "Faltan columnas CLIENTE, MUNICIPIO o COORDENADAS"
      );
    }

    const importados = [];
    const claves = new Set();

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];

      const nombre = String(
        fila[indiceNombre] ?? ""
      ).trim();

      if (!nombre) continue;

      const municipio = String(
        fila[indiceMunicipio] ?? ""
      ).trim();

      const provinciaOriginal = indiceProvincia >= 0
        ? String(fila[indiceProvincia] ?? "")
        : "";

      let provincia = "Valencia";

      if (
        normalizar(provinciaOriginal).includes("castellon")
      ) {
        provincia = "Castellón";
      }

      const coords = convertirCoordenadas(
        fila[indiceCoords]
      );

      const clave = normalizar(nombre);

      if (claves.has(clave)) continue;
      claves.add(clave);

      importados.push({
        id: generarId(),
        nombre,
        localidad: municipio,
        provincia,
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        origen: "excel"
      });
    }

    if (!importados.length) {
      throw new Error("No se encontraron clientes");
    }

    const ubicados = importados.filter(
      tieneCoordenadas
    ).length;

    const pendientes = importados.length - ubicados;

    const mensaje =
      "Se han encontrado " + importados.length +
      " clientes.\n\n" +
      "Con coordenadas: " + ubicados + "\n" +
      "Sin coordenadas: " + pendientes + "\n\n" +
      "Se actualizarán los clientes importados " +
      "anteriormente desde Excel.\n" +
      "Los clientes manuales se conservarán.\n\n" +
      "¿Continuar?";

    if (!confirm(mensaje)) return;

    const manuales = clientes.filter(
      c => c.origen !== "excel"
    );

    // Evitar duplicar clientes manuales con el Excel.
    const nombresManuales = new Set(
      manuales.map(c => normalizar(c.nombre))
    );

    const nuevosExcel = importados.filter(
      c => !nombresManuales.has(normalizar(c.nombre))
    );

    const anterior = clientes;

    clientes = [...manuales, ...nuevosExcel];

    if (!guardarClientes()) {
      clientes = anterior;
      return;
    }

    actualizarInterfaz();
    ajustarMapa();

    mostrarToast(
      "Importados: " + nuevosExcel.length +
      " clientes del Excel."
    );

  } catch (error) {
    console.error(error);
    mostrarToast("Error: " + error.message);
  } finally {
    evento.target.value = "";
    importacionExcelEnCurso = false;
    $("btnExcel").disabled = false;
    $("btnExcel").textContent = "📊 Importar Excel";
  }
}

// ============================
// ESTADÍSTICAS Y LISTA
// ============================

function actualizarInterfaz() {
  actualizarEstadisticas();
  actualizarLista();
  actualizarMarcadores();
}

function actualizarEstadisticas() {
  $("totalClientes").textContent = clientes.length;

  const municipios = new Set(
    clientes
      .filter(c => c.localidad.trim())
      .map(c =>
        normalizar(c.localidad) + "|" + c.provincia
      )
  );

  $("totalLocalidades").textContent = municipios.size;

  const ubicados = clientes.filter(
    tieneCoordenadas
  ).length;

  $("totalUbicados").textContent = ubicados;
  $("totalPendientes").textContent =
    clientes.length - ubicados;
}

function actualizarLista() {
  const contenedor = $("listaClientes");
  const busqueda = normalizar(
    $("buscarCliente").value
  );

  const filtro = $("filtroClientes").value;

  contenedor.replaceChildren();

  const filtrados = clientes.filter(c => {
    const coincide =
      normalizar(c.nombre).includes(busqueda) ||
      normalizar(c.localidad).includes(busqueda) ||
      normalizar(c.provincia).includes(busqueda);

    if (!coincide) return false;

    if (filtro === "ubicados") {
      return tieneCoordenadas(c);
    }

    if (filtro === "pendientes") {
      return !tieneCoordenadas(c);
    }

    return true;
  }).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es")
  );

  if (!filtrados.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = clientes.length
      ? "No hay clientes para este filtro."
      : "Todavía no hay clientes registrados.";
    contenedor.appendChild(p);
    return;
  }

  filtrados.forEach(c => {
    const item = document.createElement("div");
    item.className = "client-item";

    if (!tieneCoordenadas(c)) {
      item.classList.add("pending");
    }

    const nombre = document.createElement("div");
    nombre.className = "client-name";
    nombre.textContent = c.nombre;

    const localidad = document.createElement("div");
    localidad.className = "client-location";

    localidad.textContent = tieneCoordenadas(c)
      ? "📍 " + (c.localidad || "Sin municipio")
      : "⚠️ Pendiente de ubicación";

    if (!tieneCoordenadas(c)) {
      localidad.classList.add("pending-text");
    }

    const acciones = document.createElement("div");
    acciones.className = "client-actions";

    if (tieneCoordenadas(c)) {
      acciones.appendChild(
        crearBoton("Ver mapa", () => localizarCliente(c.id))
      );
    }

    acciones.appendChild(
      crearBoton("Editar", () => abrirFormulario(c.id))
    );

    const eliminar = crearBoton(
      "Eliminar",
      () => eliminarCliente(c.id)
    );

    eliminar.className = "delete";
    acciones.appendChild(eliminar);

    item.append(nombre, localidad, acciones);
    contenedor.appendChild(item);
  });
}

function crearBoton(texto, accion) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.textContent = texto;
  boton.addEventListener("click", accion);
  return boton;
}

// ============================
// MARCADORES
// ============================

function actualizarMarcadores() {
  marcadores.forEach(m => mapa.removeLayer(m));
  marcadores.clear();

  clientes.filter(tieneCoordenadas).forEach(c => {
    const marcador = L.marker(
      [c.lat, c.lng],
      { icon: iconoCliente }
    ).addTo(mapa);

    const popup = document.createElement("div");

    const titulo = document.createElement("strong");
    titulo.textContent = c.nombre;

    const detalle = document.createElement("p");
    detalle.textContent =
      (c.localidad || "Sin municipio") +
      " · " + c.provincia;

    const editar = crearBoton(
      "Editar",
      () => abrirFormulario(c.id)
    );

    popup.append(titulo, detalle, editar);
    marcador.bindPopup(popup);

    marcadores.set(c.id, marcador);
  });
}

function localizarCliente(id) {
  const c = clientes.find(c => c.id === id);

  if (!c || !tieneCoordenadas(c)) return;

  mapa.flyTo([c.lat, c.lng], 15, {
    duration: 1
  });

  const marcador = marcadores.get(id);

  if (marcador) {
    setTimeout(() => marcador.openPopup(), 1100);
  }
}

function ajustarMapa() {
  const ubicados = clientes.filter(tieneCoordenadas);

  if (!ubicados.length) {
    mapa.setView(CENTRO, ZOOM_INICIAL);
    return;
  }

  const limites = L.latLngBounds(
    ubicados.map(c => [c.lat, c.lng])
  );

  mapa.fitBounds(limites, {
    padding: [35, 35],
    maxZoom: 13
  });
}

// ============================
// FORMULARIO MANUAL
// ============================

function abrirFormulario(id = null) {
  clienteEditando = id;
  seleccionandoMapa = false;
  limpiarMarcadorTemporal();

  $("formCliente").reset();

  const c = clientes.find(c => c.id === id);

  if (c) {
    $("modalTitulo").textContent = "Editar cliente";
    $("nombreCliente").value = c.nombre;
    $("localidadCliente").value = c.localidad;
    $("provinciaCliente").value = c.provincia;

    ubicacionTemporal = tieneCoordenadas(c)
      ? { lat: c.lat, lng: c.lng }
      : null;

    $("textoUbicacion").textContent =
      ubicacionTemporal
        ? "Ubicación actual: " +
          c.lat.toFixed(5) + ", " + c.lng.toFixed(5)
        : "Este cliente todavía no tiene coordenadas.";

  } else {
    $("modalTitulo").textContent = "Añadir cliente";
    ubicacionTemporal = null;
    $("textoUbicacion").textContent =
      "Busca el municipio o selecciona un punto en el mapa.";
  }

  $("modalCliente").classList.remove("hidden");
}

function cerrarFormulario() {
  $("modalCliente").classList.add("hidden");
  seleccionandoMapa = false;
  clienteEditando = null;
  ubicacionTemporal = null;
  limpiarMarcadorTemporal();
  mapa.getContainer().style.cursor = "";
  $("mapStatus").textContent = "Mapa preparado";
}

function limpiarMarcadorTemporal() {
  if (marcadorTemporal) {
    mapa.removeLayer(marcadorTemporal);
    marcadorTemporal = null;
  }
}

function actualizarUbicacion(lat, lng) {
  ubicacionTemporal = { lat, lng };

  $("textoUbicacion").textContent =
    "📍 Posición: " +
    lat.toFixed(6) + ", " + lng.toFixed(6);

  limpiarMarcadorTemporal();

  marcadorTemporal = L.circleMarker([lat, lng], {
    radius: 11,
    color: "#e67e22",
    fillColor: "#ffb347",
    fillOpacity: .85,
    weight: 3
  }).addTo(mapa);
}

// ============================
// BUSCAR MUNICIPIO
// ============================

async function buscarLocalidad() {
  const localidad = $("localidadCliente").value.trim();
  const provincia = $("provinciaCliente").value;

  if (!localidad) {
    mostrarToast("Introduce primero el municipio.");
    return;
  }

  const boton = $("btnBuscarLocalidad");
  boton.disabled = true;
  boton.textContent = "Buscando...";

  try {
    const consulta =
      localidad + ", " + provincia + ", España";

    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=json&limit=1&countrycodes=es&q=" +
      encodeURIComponent(consulta);

    const respuesta = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!respuesta.ok) {
      throw new Error("Servicio no disponible");
    }

    const resultados = await respuesta.json();

    if (!resultados.length) {
      mostrarToast("No se encontró el municipio.");
      return;
    }

    const lat = Number(resultados[0].lat);
    const lng = Number(resultados[0].lon);

    actualizarUbicacion(lat, lng);
    mapa.flyTo([lat, lng], 14);

    mostrarToast("Municipio localizado.");

  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo realizar la búsqueda.");
  } finally {
    boton.disabled = false;
    boton.textContent = "🔎 Buscar";
  }
}

// ============================
// ELEGIR PUNTO EN MAPA
// ============================

function activarSeleccionMapa() {
  seleccionandoMapa = true;

  $("modalCliente").classList.add("hidden");
  mapa.getContainer().style.cursor = "crosshair";

  $("mapStatus").textContent =
    "Pulsa sobre el mapa para elegir la ubicación";

  mostrarToast("Selecciona un punto del mapa.");
}

mapa.on("click", evento => {
  if (!seleccionandoMapa) return;

  seleccionandoMapa = false;

  actualizarUbicacion(
    evento.latlng.lat,
    evento.latlng.lng
  );

  mapa.getContainer().style.cursor = "";
  $("modalCliente").classList.remove("hidden");
  $("mapStatus").textContent = "Ubicación seleccionada";
});

// ============================
// GUARDAR / ELIMINAR
// ============================

function procesarFormulario(evento) {
  evento.preventDefault();

  const nombre = $("nombreCliente").value.trim();
  const localidad = $("localidadCliente").value.trim();
  const provincia = $("provinciaCliente").value;

  if (!nombre) {
    mostrarToast("Introduce el nombre del cliente.");
    return;
  }

  const anterior = [...clientes];

  if (clienteEditando) {
    const indice = clientes.findIndex(
      c => c.id === clienteEditando
    );

    if (indice === -1) return;

    clientes[indice] = {
      ...clientes[indice],
      nombre,
      localidad,
      provincia,
      lat: ubicacionTemporal?.lat ?? null,
      lng: ubicacionTemporal?.lng ?? null,
      origen: "manual"
    };

  } else {
    if (!ubicacionTemporal) {
      mostrarToast("Selecciona primero una ubicación.");
      return;
    }

    clientes.push({
      id: generarId(),
      nombre,
      localidad,
      provincia,
      lat: ubicacionTemporal.lat,
      lng: ubicacionTemporal.lng,
      origen: "manual"
    });
  }

  if (!guardarClientes()) {
    clientes = anterior;
    return;
  }

  cerrarFormulario();
  actualizarInterfaz();
  mostrarToast("Cliente guardado correctamente.");
}

function eliminarCliente(id) {
  const c = clientes.find(c => c.id === id);
  if (!c) return;

  if (!confirm("¿Eliminar " + c.nombre + "?")) return;

  const anterior = [...clientes];
  clientes = clientes.filter(c => c.id !== id);

  if (!guardarClientes()) {
    clientes = anterior;
    return;
  }

  actualizarInterfaz();
  mostrarToast("Cliente eliminado.");
}

// ============================
// COPIAS JSON
// ============================

function exportarClientes() {
  const datos = JSON.stringify({
    aplicacion: "MAPRECOS",
    version: 1,
    fecha: new Date().toISOString(),
    clientes
  }, null, 2);

  const blob = new Blob([datos], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "mapa_clientes.json";
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  mostrarToast("Copia exportada.");
}

async function importarJSON(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  try {
    const datos = JSON.parse(await archivo.text());

    if (
      datos.aplicacion !== "MAPRECOS" ||
      !Array.isArray(datos.clientes) ||
      !datos.clientes.every(validarCliente)
    ) {
      throw new Error("Archivo no válido");
    }

    const ids = datos.clientes.map(c => c.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Identificadores duplicados");
    }

    if (!confirm(
      "¿Restaurar esta copia? Sustituirá todos " +
      "los clientes actuales."
    )) return;

    const anterior = clientes;

    clientes = datos.clientes.map(c => ({
      ...c,
      origen: c.origen || "manual"
    }));

    if (!guardarClientes()) {
      clientes = anterior;
      return;
    }

    actualizarInterfaz();
    ajustarMapa();
    mostrarToast("Copia restaurada.");

  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo importar el JSON.");
  } finally {
    evento.target.value = "";
  }
}

// ============================
// EVENTOS
// ============================

$("btnNuevo").addEventListener(
  "click", () => abrirFormulario()
);

$("btnCerrar").addEventListener(
  "click", cerrarFormulario
);

$("modalCliente").addEventListener("click", e => {
  if (e.target.id === "modalCliente") {
    cerrarFormulario();
  }
});

$("formCliente").addEventListener(
  "submit", procesarFormulario
);

$("btnBuscarLocalidad").addEventListener(
  "click", buscarLocalidad
);

$("btnElegirMapa").addEventListener(
  "click", activarSeleccionMapa
);

$("buscarCliente").addEventListener(
  "input", actualizarLista
);

$("filtroClientes").addEventListener(
  "change", actualizarLista
);

$("btnCentrar").addEventListener(
  "click", ajustarMapa
);

$("btnExcel").addEventListener("click", () => {
  $("archivoExcel").click();
});

$("archivoExcel").addEventListener(
  "change", importarExcel
);

$("btnExportar").addEventListener(
  "click", exportarClientes
);

$("btnImportar").addEventListener("click", () => {
  $("archivoImportar").click();
});

$("archivoImportar").addEventListener(
  "change", importarJSON
);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (seleccionandoMapa) {
      seleccionandoMapa = false;
      $("modalCliente").classList.remove("hidden");
      mapa.getContainer().style.cursor = "";
    } else {
      cerrarFormulario();
    }
  }
});

// ============================
// INICIO
// ============================

cargarClientes();

setTimeout(() => {
  mapa.invalidateSize();

  if (clientes.some(tieneCoordenadas)) {
    ajustarMapa();
  }
}, 250);

console.log("Mapa de clientes V1.1 iniciado");
