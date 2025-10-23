<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import { listProductos, type Producto } from '../api/products';
// NOTE: this function now supports both modes via { mode: 'add' | 'set' }.
// Consider renaming to `setStock` in your API helper for clarity.
import { setStockAbsolute } from '../api/inventario';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';

type PickedProduct = Producto & {
    proveedor_nombre?: string;
    proveedor: { id: number; nombre: string };
    inventario?: {
        id?: number;
        existencia?: number | string;
        importe?: number | string;
        precio_individual?: number | string;
        provee?: number | string;
    } | null;
};

const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');

const search = ref('');
const results = ref<PickedProduct[]>([]);
const selected = ref<PickedProduct | null>(null);

// Entrada (sumar)
const cantidad = ref<number | null>(null);
const entradaFecha = ref<string>(new Date().toISOString().slice(0, 10)); // YYYY-MM-DD

// Corrección (SET)
const newStock = ref<number | null>(null);

const unitPrice = computed<number>(() => Number(selected.value?.precio ?? 0));
const totalImporte = computed<number>(() => Number(cantidad.value || 0) * unitPrice.value);

const currentStock = computed<number>(() =>
    Number((selected.value as any)?.inventario?.existencia ?? 0)
);
const newImporte = computed<number>(() => {
    const target = Number(newStock.value ?? currentStock.value);
    return target * unitPrice.value;
});

// ---------- Search (debounced) ----------
const SEARCH_DELAY_MS = 350;
let t: number | undefined;

async function runSearch() {
    loading.value = true; error.value = '';
    try {
        const resp = await listProductos(
            search.value ? { search: search.value, page: 1, per_page: 10 } : { page: 1, per_page: 10 }
        );
        const arr = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        results.value = arr as PickedProduct[];
        console.log('Search results:', results.value);
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error buscando productos';
    } finally {
        loading.value = false;
    }
}

watch(search, () => {
    if (t) clearTimeout(t);
    t = window.setTimeout(runSearch, SEARCH_DELAY_MS);
});
onUnmounted(() => { if (t) clearTimeout(t); });

// ---------- Picking a product ----------
function pickProduct(p: PickedProduct) {
    selected.value = {
        ...p,
        precio: Number(p.precio),
        proveedor_nombre: (p as any).proveedor.nombre ?? '',
        inventario: (p as any).inventario ?? null,
    } as any;
    // reset form inputs
    cantidad.value = null;
    newStock.value = null;
    message.value = '';
    error.value = '';
}

// ---------- Inventory submitters ----------
const activeTab = ref<'entrada' | 'correccion'>('entrada');

function validateEntrada(): string | null {
    if (!selected.value?.id) return 'Selecciona un producto';
    const c = Number(cantidad.value);
    if (!Number.isFinite(c) || c < 0) return 'Cantidad inválida';
    if (!entradaFecha.value) return 'Selecciona fecha de entrada';
    return null;
}

function validateCorreccion(): string | null {
    if (!selected.value?.id) return 'Selecciona un producto';
    const target = Number(newStock.value);
    if (!Number.isFinite(target) || target < 0) return 'Existencia nueva inválida';
    return null;
}

// One endpoint, two modes: 'add' (sumar) | 'set' (absoluto)
async function saveStock(mode: 'add' | 'set') {
    error.value = ''; message.value = '';
    const v = mode === 'add' ? validateEntrada() : validateCorreccion();
    if (v) { error.value = v; return; }

    saving.value = true;
    try {
        const payload =
            mode === 'add'
                ? { ident: Number(selected.value!.ident), existencia: Number(cantidad.value), mode: 'add' as const }
                : { ident: Number(selected.value!.ident), existencia: Number(newStock.value), mode: 'set' as const };

        const res = await setStockAbsolute(payload as any);
        message.value = mode === 'add'
            ? 'Inventario actualizado (entrada)'
            : 'Inventario actualizado (corrección SET)';

        // Merge response inventario if present (supports different shapes)
        (selected.value as any).inventario =
            res?.data?.inventario ?? res?.inventario ?? res ?? (selected.value as any).inventario;

        await runSearch();

        // Generate receipt only for "entrada"
        if (mode === 'add') await makeReceiptPDF();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo actualizar inventario';
    } finally {
        saving.value = false;
    }
}

// ---------- PDF Receipt ----------
function barcodePng(value: string) {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, margin: 0, width: 1.6, height: 60 });
    return canvas.toDataURL('image/png');
}
function currency(n: number, currency = 'MXN', locale = 'es-MX') {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
}

async function makeReceiptPDF() {
    console.log('Generating receipt PDF...');
    console.log({ selected: selected.value, cantidad: cantidad.value, entradaFecha: entradaFecha.value });
    if (!selected.value?.id) return;

    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const ymd = entradaFecha.value || new Date().toISOString().slice(0, 10);

    // Header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Entrada de inventario', 15, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Fecha: ${ymd}`, 15, 27);
    doc.text(`Proveedor: ${selected.value.proveedor_nombre || '(desconocido)'}`, 15, 33);

    // Product
    doc.setDrawColor(220); doc.rect(12, 40, 186, 52);
    doc.setFont('helvetica', 'bold'); doc.text('Producto', 15, 47);
    doc.setFont('helvetica', 'normal');
    doc.text(selected.value.nombre || 'Producto', 15, 53);
    doc.text(`Ident: ${String(selected.value.ident).padStart(6, '0')}`, 15, 58);

    const url = barcodePng(String(selected.value.ident).padStart(6, '0'));
    doc.addImage(url, 'PNG', 150, 44, 42, 16);

    // Amounts
    doc.setFont('helvetica', 'bold'); doc.text('Detalle', 15, 70);
    doc.setFont('helvetica', 'normal');
    const u = unitPrice.value;
    const c = Number(cantidad.value || 0);
    const total = totalImporte.value;

    doc.text(`Cantidad: ${c}`, 15, 76);
    doc.text(`Precio unitario: ${currency(u)}`, 15, 82);
    doc.setFont('helvetica', 'bold');
    doc.text(`Importe: ${currency(total)}`, 15, 88);

    // Footer
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Firma proveedor:', 15, 110); doc.line(45, 110, 110, 110);
    doc.text('Firma recepción:', 120, 110); doc.line(150, 110, 200, 110);

    const fname = `entrada_${String(selected.value.ident).padStart(6, '0')}_${ymd}.pdf`;
    doc.save(fname);
}

// Money helper for template
const money = (v: number | string | null | undefined, currency = 'MXN', locale = 'es-MX') => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return '—';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
    } catch {
        return `$${n.toFixed(2)}`;
    }
};

// Init
onMounted(() => { runSearch(); });
</script>

<template>
    <AppLayout>
        <div class="bg-white border border-gray-200 rounded-xl shadow p-6">
            <h2 class="text-2xl font-semibold mb-6">Entrada de inventario</h2>

            <!-- Tabs -->
            <div class="border-b border-gray-200 mb-4 flex gap-1">
                <button class="px-4 py-2 text-sm rounded-t-md" :class="activeTab === 'entrada'
                    ? 'bg-white border border-b-0 border-gray-200 -mb-px font-medium'
                    : 'text-gray-600 hover:text-gray-900'" @click="activeTab = 'entrada'" type="button">Entrada
                    (agregar a inventario)</button>

                <button class="px-4 py-2 text-sm rounded-t-md" :class="activeTab === 'correccion'
                    ? 'bg-white border border-b-0 border-gray-200 -mb-px font-medium'
                    : 'text-gray-600 hover:text-gray-900'" @click="activeTab = 'correccion'" type="button">Corrección
                    (actualizar inventario)</button>
            </div>

            <div class="rounded-b-md border border-gray-200 p-4 space-y-4">
                <!-- Datos del producto -->
                <div v-if="selected?.id" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Producto</label>
                        <input :value="selected?.nombre" class="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2"
                            disabled />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Ident</label>
                        <input :value="String(selected?.ident).padStart(6, '0')"
                            class="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2" disabled />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Precio unitario</label>
                        <input :value="unitPrice.toFixed(2)"
                            class="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2" disabled />
                    </div>
                </div>

                <!-- TAB: ENTRADA (sumar) -->
                <div v-if="selected?.id && activeTab === 'entrada'" class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad a ingresar</label>
                            <input v-model.number="cantidad" type="number" min="0" step="1"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="0" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de entrada</label>
                            <input v-model="entradaFecha" type="date"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Importe total</label>
                            <div class="h-[38px] flex items-center px-3 rounded-lg border border-gray-200 bg-gray-50">
                                <div class="text-lg font-semibold text-[#E4007C]">
                                    {{ new Intl.NumberFormat('es-MX', {
                                        style: 'currency', currency: 'MXN'
                                    }).format(totalImporte) }}
                                </div>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">cantidad × precio unitario</p>
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <button :disabled="saving || !selected?.id || !cantidad" @click="saveStock('add')"
                            class="rounded-lg bg-[#E4007C] hover:bg-[#cc006f] text-white px-4 py-2 text-sm disabled:opacity-60">Guardar
                            entrada + recibo</button>

                        <button type="button" :disabled="!selected?.id || !cantidad" @click="makeReceiptPDF"
                            class="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">Generar
                            recibo (PDF) sin guardar</button>
                    </div>
                </div>

                <!-- TAB: CORRECCIÓN (SET absoluto) -->
                <div v-if="selected?.id && activeTab === 'correccion'" class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Existencia actual</label>
                            <input :value="currentStock + ' unidades'"
                                class="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2" disabled />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Existencia nueva</label>
                            <input v-model.number="newStock" type="number" min="0" step="1"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="0" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Importe nuevo</label>
                            <div class="h-[38px] flex items-center px-3 rounded-lg border border-gray-200 bg-gray-50">
                                <div class="text-lg font-semibold text-[#E4007C]">
                                    {{ new Intl.NumberFormat('es-MX', {
                                        style: 'currency', currency: 'MXN'
                                    }).format(newImporte) }}
                                </div>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">existencia nueva × precio unitario</p>
                        </div>
                    </div>

                    <div>
                        <button :disabled="saving || newStock === null || newStock < 0" @click="saveStock('set')"
                            class="rounded-lg bg-black hover:bg-gray-800 text-white px-4 py-2 text-sm disabled:opacity-60">Actualizar
                            inventario (SET)</button>
                    </div>
                </div>
            </div>

            <!-- alerts -->
            <div v-if="message"
                class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-2 text-sm">
                {{ message }}
            </div>
            <div v-if="error" class="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm">
                {{ error }}
            </div>

            <!-- search & results -->
            <div class="mb-5">
                <label class="block text-sm font-medium text-gray-700 mb-1">Buscar producto</label>
                <div class="relative">
                    <input v-model="search" type="text" placeholder="Nombre, descripción, ident…"
                        class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2 pr-9" />
                    <button v-if="search"
                        class="absolute inset-y-0 right-0 mr-2 my-1 px-2 text-sm text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
                        @click="search = ''; runSearch()" type="button" aria-label="Limpiar búsqueda">✕</button>
                </div>

                <div class="mt-3 border rounded-lg max-h-48 overflow-auto">
                    <table class="min-w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500">
                            <tr>
                                <th class="text-left font-medium px-3 py-2">ID</th>
                                <th class="text-left font-medium px-3 py-2">Producto Ident</th>
                                <th class="text-left font-medium px-3 py-2">Producto</th>
                                <th class="text-left font-medium px-3 py-2">Proveedor</th>
                                <th class="text-left font-medium px-3 py-2">Existencia</th>
                                <th class="text-right font-medium px-3 py-2">Precio</th>
                                <th class="text-left font-medium px-3 py-2">Importe</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in results" :key="p.id" @click="pickProduct(p)"
                                :class="['cursor-pointer hover:bg-gray-50', selected?.id === p.id ? 'bg-gray-100' : '']">
                                <td class="px-3 py-2">{{ p.id }}</td>
                                <td class="px-3 py-2">{{ p.ident }}</td>
                                <td class="px-3 py-2">{{ p.nombre }}</td>
                                <td class="px-3 py-2">{{ p.proveedor.nombre }}</td>
                                <td class="px-3 py-2">{{ (p as any)?.inventario?.existencia ?? 0 }} unidades</td>
                                <td class="px-3 py-2 text-right">{{ money(p.precio) }}</td>
                                <td class="px-3 py-2 text-left">{{ money((p as any)?.inventario?.importe) }}</td>
                            </tr>
                            <tr v-if="!loading && results.length === 0">
                                <td colspan="6" class="px-3 py-3 text-center text-gray-500">Sin resultados</td>
                            </tr>
                            <tr v-if="loading">
                                <td colspan="6" class="px-3 py-3 text-center text-gray-500">Buscando…</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
