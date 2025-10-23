<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import {
    listProductos, createProducto, updateProducto, deleteProducto,
    listProveedores, setStock, bulkUploadCSV, type Producto, type Proveedor
} from '../api/products';

import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';

/* ---------- Label printing controls ---------- */
const gridPreset = ref<'5x5' | '6x6' | '7x7'>('6x6');
const includePrice = ref(false); // 👈 bind your checkbox to this
const copies = ref(1);           // pages to print

// 👈 nice currency formatting for the price text
function formatMoney(n?: number, currency = 'MXN', locale = 'es-MX') {
    if (typeof n !== 'number') return '';
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
}

/** Page setup: Letter portrait (change to A4 if you prefer) */
const PAGE = { format: 'letter' as const, w: 215.9, h: 279.4 }; // mm
/** Gutters & margins (mm) — tweak to your printer/sheet */
const gutterX = 3, gutterY = 3, margin = 8;

/** Parse "6x6" -> {rows:6, cols:6} */
function parseGrid(preset: '5x5' | '6x6' | '7x7') {
    const [c, r] = preset.split('x').map(Number);
    return { cols: c, rows: r };
}

/** Compute label width/height (mm) based on grid + page */
function computeLabelBox(rows: number, cols: number) {
    const usableW = PAGE.w - margin * 2;
    const usableH = PAGE.h - margin * 2;
    const w = (usableW - gutterX * (cols - 1)) / cols;
    const h = (usableH - gutterY * (rows - 1)) / rows;
    return { w, h };
}

/** Create an offscreen barcode PNG data URL */
function barcodePngDataURL(value: string) {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        width: 1.2,
        height: 24,
    });
    return canvas.toDataURL('image/png');
}

/** Draw one label at (x,y) with given box size */
function drawLabel(
    doc: jsPDF,
    x: number,
    y: number,
    boxW: number,
    boxH: number,
    productName: string,
    identStr: string,
    price?: number | string,    // allow string
    showPrice?: boolean
) {
    const pad = 2;
    const bcH = Math.max(12, boxH - 12);
    const bcW = boxW - pad * 2;

    const url = barcodePngDataURL(identStr);
    doc.addImage(url, 'PNG', x + pad, y + pad, bcW, Math.min(bcH, 20), undefined, 'FAST');

    // Text
    const name = productName ? (productName.length > 28 ? productName.slice(0, 28) + '…' : productName) : 'Producto';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    const textTop = y + pad + Math.min(bcH, 20) + 2;
    doc.setTextColor(0, 0, 0);
    doc.text(name, x + pad, textTop);
    doc.text('#' + identStr, x + pad, textTop + 4);

    // --- PRICE ---
    const priceNum = typeof price === 'number' ? price : Number(price);
    if (showPrice && Number.isFinite(priceNum)) {
        doc.setFont('helvetica', 'bold');      // a bit stronger
        doc.setTextColor(228, 0, 124);         // brand color #E4007C
        const priceStr = formatMoney(priceNum) || `$${priceNum.toFixed(2)}`;

        // keep inside label box even if small
        const priceY = Math.min(textTop + 8, y + boxH - pad - 1);
        doc.text(priceStr, x + boxW - pad, priceY, { align: 'right' as const });

        // restore
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
    }

    // optional trim box (comment if you don’t want borders)
     doc.setDrawColor(235); doc.rect(x, y, boxW, boxH);
}
/** Print multiple pages. Each page is a full grid. */
function printLabels() {
    if (!form.ident) { error.value = 'Falta identificador interno'; return; }

    const pagesToPrint = Math.max(1, Number(copies.value || 1)); // pages, not labels
    const { rows = 1, cols = 1 } = parseGrid(gridPreset.value) ?? {};
    const box = computeLabelBox(rows, cols);

    const doc = new jsPDF({ unit: 'mm', format: PAGE.format });

    for (let pageIdx = 0; pageIdx < pagesToPrint; pageIdx++) {
        if (pageIdx > 0) doc.addPage(PAGE.format, 'portrait');

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = margin + c * (box.w + gutterX);
                const y = margin + r * (box.h + gutterY);
                drawLabel(
                    doc,
                    x, y,
                    box.w, box.h,
                    form.nombre,
                    String(form.ident).padStart(6, '0'),
                    Number(form.precio),         // <-- ensure number
                    includePrice.value // 👈 checkbox controls price text
                );
            }
        }
    }

    const perPage = rows * cols;
    doc.save(`etiquetas_${String(form.ident).padStart(6, '0')}_${gridPreset.value}_${pagesToPrint}p_${perPage}pp.pdf`);
}

/* ---------- state ---------- */
const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');

const q = ref('');
const productos = ref<Producto[]>([]);
const selectedId = ref<number | null>(null);
const proveedores = ref<Proveedor[]>([]);

type FormT = {
    id?: number | null;
    ident: number | null;
    nombre: string;
    descripcion: string;
    proveedorid: number | null;
    precio: number | null;
    fecha: string; // YYYY-MM-DD
    cantidadInicial: number | null; // for inventory
};
const form = reactive<FormT>({
    id: null,
    ident: null,
    nombre: '',
    descripcion: '',
    proveedorid: null,
    precio: null,
    fecha: new Date().toISOString().slice(0, 10),
    cantidadInicial: null,
});

const barcodeRef = ref<SVGSVGElement | null>(null);
function renderBarcode() {
    if (!barcodeRef.value || !form.ident) return;
    JsBarcode(barcodeRef.value, String(form.ident), {
        format: 'CODE128',
        width: 1.6,
        height: 60,
        displayValue: true,
        fontSize: 12,
        margin: 0
    });
}

/* ---------- helpers ---------- */
function randIdent(): number {
    return Math.floor(100000 + Math.random() * 900000);
}
function resetForm() {
    form.id = null;
    form.ident = randIdent();
    form.nombre = '';
    form.descripcion = '';
    form.proveedorid = null;
    form.precio = null;
    form.fecha = new Date().toISOString().slice(0, 10);
    form.cantidadInicial = null;
    selectedId.value = null;
    message.value = '';
    error.value = '';
}
async function loadList() {
    loading.value = true;
    try {
        const data = await listProductos(q.value ? { search: q.value, page: 1, per_page: 20 } : undefined);
        productos.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error listando productos';
    } finally {
        loading.value = false;
    }
}
async function loadProveedores() {
    try {
        const resp = await listProveedores();
        if (Array.isArray(resp)) {
            proveedores.value = resp;
        } else if (resp && Array.isArray((resp as { data?: unknown }).data)) {
            proveedores.value = (resp as { data: Proveedor[] }).data;
        } else {
            proveedores.value = [];
        }
    } catch { /* ignore */ }
}
async function selectRow(p: Producto) {
    selectedId.value = p.id;
    form.id = p.id;
    form.ident = p.ident;
    form.nombre = p.nombre;
    form.descripcion = p.descripcion || '';
    form.proveedorid = p.proveedorid;
    form.precio = p.precio;
    form.fecha = p.fecha || new Date().toISOString().slice(0, 10);
    form.cantidadInicial = null;
    message.value = ''; error.value = '';
}
async function submitCreateOrUpdate() {
    error.value = ''; message.value = '';
    if (!form.ident) form.ident = randIdent();
    if (!form.nombre || !form.proveedorid || !form.precio) {
        error.value = 'Nombre, Proveedor y Precio son obligatorios';
        console.log(form);
        return;
    }

    saving.value = true;
    try {
        let saved: Producto;
        if (form.id) {
            saved = await updateProducto(form.id, {
                ident: form.ident!, nombre: form.nombre, descripcion: form.descripcion,
                proveedorid: form.proveedorid!, precio: form.precio!, fecha: form.fecha
            });
            message.value = 'Producto actualizado';
        } else {
            saved = await createProducto({
                ident: form.ident!, nombre: form.nombre, descripcion: form.descripcion,
                proveedorid: form.proveedorid!, precio: form.precio!, fecha: form.fecha
            });
            message.value = 'Producto creado';
            form.id = saved.id;
            selectedId.value = saved.id;
            await loadList();
        }

        if (form.cantidadInicial != null && form.proveedorid && form.ident) {
            await setStock(form.ident, Number(form.cantidadInicial), Number(form.proveedorid));
        }

        await loadList();
    } catch (e: any) {
        if (e?.response?.status === 422) {
            const errs = e.response.data?.errors || {};
            error.value = Object.values(errs).flat().join(' & ');
        } else {
            error.value = e?.response?.data?.message || 'Error guardando';
        }
    } finally {
        saving.value = false;
    }
}
async function remove() {
    if (!form.id) return;
    if (!confirm('¿Eliminar producto?')) return;
    saving.value = true; error.value = ''; message.value = '';
    try {
        await deleteProducto(form.id);
        message.value = 'Producto eliminado';
        resetForm();
        await loadList();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo eliminar';
    } finally {
        saving.value = false;
    }
}

/* ---------- CSV Upload ---------- */
const csvFile = ref<File | null>(null);
async function uploadCSV() {
    if (!csvFile.value) return;
    saving.value = true; error.value = ''; message.value = '';
    try {
        await bulkUploadCSV(csvFile.value);
        message.value = 'Carga masiva enviada';
        await loadList();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error en carga masiva';
    } finally {
        saving.value = false; csvFile.value = null;
    }
}

/* ---------- barcode preview (svg) ---------- */

watch(q, () => loadList());
watch(() => form.ident, () => { renderBarcode(); });

onMounted(async () => {
    resetForm();
    await loadProveedores();
    await loadList();
    renderBarcode();
});
</script>

<template>
    <AppLayout>
        <div class="bg-white border border-gray-200 rounded-xl shadow p-6">
            <h2 class="text-2xl font-semibold mb-6">Crear producto</h2>

            <!-- Alerts -->
            <div v-if="message"
                class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-2 text-sm">
                {{ message }}
            </div>
            <div v-if="error" class="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm">
                {{ error }}
            </div>

            <!-- ===== FORM (full width) ===== -->
            <div class="space-y-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <!-- Identificador + barcode -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Identificador interno</label>
                        <div class="flex gap-2">
                            <input v-model.number="form.ident" type="number" inputmode="numeric"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="6 dígitos" />
                            <button type="button" @click="form.ident = randIdent()"
                                class="shrink-0 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                                Generar
                            </button>
                        </div>
                        <div class="mt-3 border rounded-lg p-3 bg-white flex items-center justify-center">
                            <svg ref="barcodeRef"></svg>
                        </div>
                    </div>

                    <!-- Proveedor -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
                        <select v-model.number="form.proveedorid"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2">
                            <option :value="null" disabled>Selecciona proveedor</option>
                            <option v-for="p in proveedores" :key="p.ident" :value="p.ident">{{ p.nombre }}</option>
                        </select>
                    </div>

                    <!-- Nombre -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Nombre de producto</label>
                        <input v-model="form.nombre" type="text"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Nombre del producto" />
                    </div>

                    <!-- Fecha -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de creación</label>
                        <input v-model="form.fecha" type="date"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                    </div>

                    <!-- Precio -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Precio de venta</label>
                        <input v-model.number="form.precio" type="number" step="0.01" min="0"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Precio unitario" />
                    </div>

                    <!-- Cantidad inicial -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad inicial</label>
                        <input v-model.number="form.cantidadInicial" type="number" step="1" min="0"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Cantidad inicial" />
                    </div>
                </div>

                <!-- Descripción -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                    <input v-model="form.descripcion" type="text"
                        class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                        placeholder="Descripción del producto" />
                </div>

                <!-- Opciones etiqueta (mock for now) -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <!-- Grid preset -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Distribución por hoja</label>
                        <select v-model="gridPreset"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2">
                            <option value="5x5">5 × 5 (25 etiquetas/hoja)</option>
                            <option value="6x6">6 × 6 (36 etiquetas/hoja)</option>
                            <option value="7x7">7 × 7 (49 etiquetas/hoja)</option>
                        </select>
                        <p class="text-xs text-gray-500 mt-1">
                            Hoja Carta. Calculamos el tamaño de la etiqueta según filas/columnas.
                        </p>
                    </div>

                    <!-- Incluir precio -->
                    <div class="flex items-center">
                        <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                            <input v-model="includePrice" type="checkbox"
                                class="rounded border-gray-300 text-gray-900 focus:ring-gray-900">
                            Incluir precio
                        </label>
                    </div>

                    <!-- Copias -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Copias</label>
                        <input v-model.number="copies" type="number" min="1"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Cantidad de etiquetas" />
                        <p class="text-xs text-gray-500 mt-1">
                            Número de <b>páginas</b> a imprimir. Cada página imprime {{ gridPreset.split('x')[0] }}×{{
                                gridPreset.split('x')[1] }}
                            etiquetas ({{ Number(gridPreset.split('x')[0]) * Number(gridPreset.split('x')[1]) }} por
                            página).
                        </p>
                    </div>
                </div>
                <!-- Botón imprimir -->
                <div class="mt-3">
                    <button type="button" @click="printLabels"
                        class="rounded-lg bg-gray-100 px-4 py-2 text-sm hover:bg-gray-50">
                        Imprimir etiquetas (PDF)
                    </button>
                </div>
            </div>

            <!-- ===== ACTIONS ===== -->
            <div class="mt-6 flex flex-wrap gap-2">
                <button :disabled="saving" @click="submitCreateOrUpdate"
                    class="rounded-lg bg-[#E4007C] hover:bg-[#cc006f] text-white px-4 py-2 text-sm disabled:opacity-60">
                    {{ form.id ? 'Actualizar producto' : 'Crear producto' }}
                </button>
                <button :disabled="!form.id || saving" @click="remove"
                    class="rounded-lg bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 text-sm disabled:opacity-60">
                    Eliminar producto
                </button>
            </div>

            <!-- ===== SEARCH / TABLE (moved below the form) ===== -->
            <div class="mt-10">
                <div class="mb-3">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Buscar / Consultar</label>
                    <input v-model="q" type="text" placeholder="Nombre, descripción, código…"
                        class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                </div>

                <div class="max-h-96 overflow-auto border border-gray-200 rounded-lg">
                    <table class="min-w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500">
                            <tr>
                                <th class="text-left font-medium px-3 py-2">ID</th>
                                <th class="text-left font-medium px-3 py-2">Ident</th>
                                <th class="text-left font-medium px-3 py-2">Nombre</th>
                                <th class="text-right font-medium px-3 py-2">Precio</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in productos" :key="p.id" @click="selectRow(p)"
                                :class="['cursor-pointer hover:bg-gray-50', selectedId === p.id ? 'bg-gray-100' : '']">
                                <td class="px-3 py-2">{{ p.id }}</td>
                                <td class="px-3 py-2">{{ p.ident }}</td>
                                <td class="px-3 py-2">{{ p.nombre }}</td>
                                <td class="px-3 py-2 text-right">{{ Number(p.precio).toFixed(2) }}</td>
                            </tr>
                            <tr v-if="!loading && productos.length === 0">
                                <td colspan="4" class="px-3 py-3 text-center text-gray-500">Sin resultados</td>
                            </tr>
                            <tr v-if="loading">
                                <td colspan="4" class="px-3 py-3 text-center text-gray-500">Cargando…</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ===== CSV UPLOAD ===== -->
            <div class="mt-8 space-y-2">
                <label class="block text-sm font-medium text-gray-700">Subir archivo de productos (CSV)</label>
                <input type="file" accept=".csv"
                    @change="e => csvFile = (e.target as HTMLInputElement).files?.[0] || null"
                    class="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-sm hover:file:bg-gray-50" />
                <button :disabled="!csvFile || saving" @click="uploadCSV"
                    class="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
                    Subir archivo
                </button>
                <p class="text-xs text-gray-500">Endpoint esperado: <code>/api/productos/bulk-upload</code></p>
            </div>
        </div>
    </AppLayout>
</template>
