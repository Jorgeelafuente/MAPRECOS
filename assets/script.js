
"use strict";

// MAPRECOS V1.0
// Mapa interactivo de clientes

const STORAGE_KEY = "maprecos_clientes_v1";

const CENTRO = [39.65, -0.35];
const ZOOM_INICIAL = 9;

let clientes = [];
let marcadores = new Map();
let clienteEditando = null;
let ubicacionTemporal = null;
let marcadorTemporal = null;
let seleccionandoMapa = false;
let toastTimer = null;

const $ = id => document.getElementById(id);

// =============================
// MAPA
// =============================

const mapa = L.map("map", {
  zoomControl: true
}).setView(CENTRO, ZOOM_INICIAL);

L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }
).addTo(mapa);

const iconoCliente = L.divIcon({
  className: "custom-marker",
  html: `
    <div style="
      width:30px;
      height:30px;
      background:#0078c8;
      border:3px solid white;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 3px 9px #0004;
      display:flex;
      align-items:center;
      justify-content:center;
    ">
      <span style="
        transform:rotate(45deg);
        color:white;
        font-size:14px;
      ">●</span>
    </div>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

// =============================
// ALMACENAMIENTO
// =============================

function cargarClientes() {
  try {
    const datos = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

    clientes = Array.isArray(datos)
      ? datos.filter(validarCliente)
      : [];
  } catch (error) {
    console.error(error);
    clientes = [];
    mostrarToast("No se pudieron leer los datos guardados.");
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
    mostrarToast("Error al guardar. Revisa el almacenamiento.");
    return false;
  }
}

function validarCliente(c) {
  return c &&
    typeof c.id === "string" &&
    typeof c.nombre === "string" &&
    c.nombre.trim().length > 0 &&
    typeof c.localidad === "string" &&
    c.localidad.trim().length > 0 &&
    ["Valencia", "Castellón"].includes(c.provincia) &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    c.lat >= -90 && c.lat <= 90 &&
    c.lng >= -180 && c.lng <= 180;
}

// =============================
// INTERFAZ
// =============================

function actualizarInterfaz() {
  actualizarEstadisticas();
  actualizarLista();
  actualizarMarcadores();
}

function actualizarEstadisticas() {
  $("totalClientes").textContent = clientes.length;

  const localidades = new Set(
    clientes.map(c =>
      c.localidad.trim().toLocaleLowerCase("es")
      + "|" + c.provincia
    )
  );

  $("totalLocalidades").textContent = localidades.size;
}

function actualizarLista() {
  const contenedor = $("listaClientes");
  const busqueda = normalizar($("buscarCliente").value);

  contenedor.replaceChildren();

  const filtrados = clientes
    .filter(c =>
      normalizar(c.nombre).includes(busqueda) ||
      normalizar(c.localidad).includes(busqueda) ||
      normalizar(c.provincia).includes(busqueda)
    )
    .sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es")
    );

  if (!filtrados.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = clientes.length
      ? "No hay resultados para esta búsqueda."
      : "Todavía no hay clientes registrados.";
    contenedor.appendChild(p);
    return;
  }

  filtrados.forEach(cliente => {
    const item = document.createElement("div");
    item.className = "client-item";

    const nombre = document.createElement("div");
    nombre.className = "client-name";
    nombre.textContent = cliente.nombre;

    const localidad = document.createElement("div");
    localidad.className = "client-location";
    localidad.textContent =
      "📍 " + cliente.localidad +
      " · " + cliente.provincia;

    const acciones = document.createElement("div");
    acciones.className = "client-actions";

    const localizar = crearBoton(
      "Ver mapa",
      () => localizarCliente(cliente.id)
    );

    const editar = crearBoton(
      "Editar",
      () => abrirFormulario(cliente.id)
    );

    const eliminar = crearBoton(
      "Eliminar",
      () => eliminarCliente(cliente.id)
    );

    eliminar.className = "delete";

    acciones.append(localizar, editar, eliminar);
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

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

// =============================
// MARCADORES
// =============================

function actualizarMarcadores() {
  marcadores.forEach(marcador => {
    mapa.removeLayer(marcador);
  });

  marcadores.clear();

  clientes.forEach(cliente => {
    const marcador = L.marker(
      [cliente.lat, cliente.lng],
      { icon: iconoCliente }
    ).addTo(mapa);

    const popup = document.createElement("div");

    const titulo = document.createElement("strong");
    titulo.textContent = cliente.nombre;

    const detalle = document.createElement("p");
    detalle.textContent =
      cliente.localidad + ", " + cliente.provincia;

    const boton = crearBoton(
      "Editar cliente",
      () => abrirFormulario(cliente.id)
    );

    popup.append(titulo, detalle, boton);

    marcador.bindPopup(popup);
    marcadores.set(cliente.id, marcador);
  });
}

function localizarCliente(id) {
  const cliente = clientes.find(c => c.id === id);
  if (!cliente) return;

  mapa.flyTo([cliente.lat, cliente.lng], 13, {
    duration: 1
  });

  const marcador = marcadores.get(id);
  if (marcador) {
    setTimeout(() => marcador.openPopup(), 1100);
  }
}

// =============================
// FORMULARIO
// =============================

function abrirFormulario(id = null) {
  clienteEditando = id;
  seleccionandoMapa = false;
  limpiarMarcadorTemporal();

  $("formCliente").reset();

  const cliente = clientes.find(c => c.id === id);

  if (cliente) {
    $("modalTitulo").textContent = "Editar cliente";
    $("nombreCliente").value = cliente.nombre;
    $("localidadCliente").value = cliente.localidad;
    $("provinciaCliente").value = cliente.provincia;

    ubicacionTemporal = {
      lat: cliente.lat,
      lng: cliente.lng
    };

    $("textoUbicacion").textContent =
      "Ubicación actual: " +
      cliente.lat.toFixed(5) + ", " +
      cliente.lng.toFixed(5);
  } else {
    $("modalTitulo").textContent = "Añadir cliente";
    ubicacionTemporal = null;

    $("textoUbicacion").textContent =
      "Busca la localidad o selecciona un punto en el mapa.";
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
    "📍 Posición seleccionada: " +
    lat.toFixed(5) + ", " + lng.toFixed(5);

  limpiarMarcadorTemporal();

  marcadorTemporal = L.circleMarker([lat, lng], {
    radius: 11,
    color: "#e67e22",
    fillColor: "#ffb347",
    fillOpacity: 0.85,
    weight: 3
  }).addTo(mapa);
}

// =============================
// BUSCAR LOCALIDAD
// =============================

async function buscarLocalidad() {
  const localidad = $("localidadCliente").value.trim();
  const provincia = $("provinciaCliente").value;

  if (!localidad) {
    mostrarToast("Introduce primero una localidad.");
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
      "?format=json&limit=1&countrycodes=es" +
      "&q=" + encodeURIComponent(consulta);

    const respuesta = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!respuesta.ok) {
      throw new Error("Error del servicio de búsqueda");
    }

    const resultados = await respuesta.json();

    if (!resultados.length) {
      mostrarToast("No se encontró esa localidad.");
      return;
    }

    const lat = Number(resultados[0].lat);
    const lng = Number(resultados[0].lon);

    actualizarUbicacion(lat, lng);

    mapa.flyTo([lat, lng], 13);

    mostrarToast("Localidad encontrada correctamente.");

  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo buscar la localidad.");
  } finally {
    boton.disabled = false;
    boton.textContent = "🔎 Buscar localidad";
  }
}

// =============================
// SELECCIONAR EN MAPA
// =============================

function activarSeleccionMapa() {
  const localidad = $("localidadCliente").value.trim();

  if (!localidad) {
    mostrarToast("Escribe primero la localidad.");
    return;
  }

  seleccionandoMapa = true;
  $("modalCliente").classList.add("hidden");

  mapa.getContainer().style.cursor = "crosshair";

  $("mapStatus").textContent =
    "Haz clic en el punto donde está el cliente";

  mostrarToast("Pulsa sobre el mapa para elegir la ubicación.");
}

mapa.on("click", function(evento) {
  if (!seleccionandoMapa) return;

  seleccionandoMapa = false;

  actualizarUbicacion(
    evento.latlng.lat,
    evento.latlng.lng
  );

  $("modalCliente").classList.remove("hidden");

  mapa.getContainer().style.cursor = "";
  $("mapStatus").textContent = "Ubicación seleccionada";
});

// =============================
// GUARDAR CLIENTE
// =============================

function procesarFormulario(evento) {
  evento.preventDefault();

  const nombre = $("nombreCliente").value.trim();
  const localidad = $("localidadCliente").value.trim();
  const provincia = $("provinciaCliente").value;

  if (!nombre || !localidad) {
    mostrarToast("Completa nombre y localidad.");
    return;
  }

  if (!ubicacionTemporal) {
    mostrarToast("Busca o selecciona una ubicación.");
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
      ...ubicacionTemporal
    };
  } else {
    clientes.push({
      id: generarId(),
      nombre,
      localidad,
      provincia,
      ...ubicacionTemporal
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

function generarId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Date.now().toString(36) +
    Math.random().toString(36).slice(2);
}

// =============================
// ELIMINAR
// =============================

function eliminarCliente(id) {
  const cliente = clientes.find(c => c.id === id);
  if (!cliente) return;

  if (!confirm(
    "¿Eliminar el cliente " + cliente.nombre + "?"
  )) return;

  const anterior = [...clientes];

  clientes = clientes.filter(c => c.id !== id);

  if (!guardarClientes()) {
    clientes = anterior;
    return;
  }

  actualizarInterfaz();
  mostrarToast("Cliente eliminado.");
}

// =============================
// EXPORTAR / IMPORTAR
// =============================

function exportarClientes() {
  const contenido = JSON.stringify(
    {
      aplicacion: "MAPRECOS",
      version: 1,
      fecha: new Date().toISOString(),
      clientes
    },
    null,
    2
  );

  const blob = new Blob([contenido], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");

  enlace.href = url;
  enlace.download = "MAPRECOS_clientes.json";
  enlace.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  mostrarToast("Copia de seguridad exportada.");
}

async function importarClientes(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  try {
    const texto = await archivo.text();
    const datos = JSON.parse(texto);

    if (
      !datos ||
      datos.aplicacion !== "MAPRECOS" ||
      !Array.isArray(datos.clientes)
    ) {
      throw new Error("Archivo no compatible");
    }

    if (!datos.clientes.every(validarCliente)) {
      throw new Error("Hay clientes con datos incorrectos");
    }

    const ids = new Set(
      datos.clientes.map(c => c.id)
    );

    if (ids.size !== datos.clientes.length) {
      throw new Error("Hay identificadores duplicados");
    }

    if (!confirm(
      "¿Importar " + datos.clientes.length +
      " clientes? Se sustituirá la lista actual."
    )) return;

    const anterior = clientes;
    clientes = datos.clientes;

    if (!guardarClientes()) {
      clientes = anterior;
      return;
    }

    actualizarInterfaz();
    mostrarToast("Clientes importados correctamente.");

  } catch (error) {
    console.error(error);
    mostrarToast("Error: archivo JSON no válido.");
  } finally {
    evento.target.value = "";
  }
}

// =============================
// MENSAJES
// =============================

function mostrarToast(mensaje) {
  const toast = $("toast");

  toast.textContent = mensaje;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

// =============================
// EVENTOS
// =============================

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

$("btnCentrar").addEventListener("click", () => {
  mapa.flyTo(CENTRO, ZOOM_INICIAL);
});

$("btnExportar").addEventListener(
  "click", exportarClientes
);

$("btnImportar").addEventListener("click", () => {
  $("archivoImportar").click();
});

$("archivoImportar").addEventListener(
  "change", importarClientes
);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    cerrarFormulario();
  }
});

// =============================
// INICIALIZACIÓN
// =============================

cargarClientes();

setTimeout(() => {
  mapa.invalidateSize();
}, 200);

console.log("MAPRECOS V1.0 iniciado correctamente");
