<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import { listProductos, type Producto } from '../api/products';
// NOTE: this function now supports both modes via { mode: 'add' | 'set' }.
// Consider renaming to `setStock` in your API helper for clarity.
import { setStockAbsolute } from '../api/inventario';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';

type PickedProduct = Producto & {
    proveedor_nombre?: string;
    proveedor?: { id: number; nombre: string } | null;
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
const pagination = reactive({
    page: 1,
    perPage: 10,
    lastPage: 1,
    total: 0
});
const pageNumbers = computed(() => {
    const pages = Math.max(1, pagination.lastPage || 1);
    return Array.from({ length: pages }, (_, idx) => idx + 1);
});
const pageInfo = computed(() => {
    if (!pagination.total) return null;
    const start = (pagination.page - 1) * pagination.perPage + 1;
    const end = Math.min(start + pagination.perPage - 1, pagination.total);
    return { start, end };
});

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
        const params: Record<string, any> = {
            page: pagination.page,
            per_page: pagination.perPage
        };
        if (search.value) params.search = search.value;
        const resp = await listProductos(params);
        const arr = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        results.value = arr as PickedProduct[];
        console.log('Search results:', results.value);

        const meta = resp?.meta ?? null;
        const total = meta?.total ?? resp?.total ?? arr.length;
        const lastPage = meta?.last_page ?? meta?.lastPage ?? (total ? Math.ceil(total / pagination.perPage) : 1);
        pagination.total = total;
        pagination.lastPage = Math.max(1, lastPage || 1);
        if (pagination.page > pagination.lastPage) {
            pagination.page = pagination.lastPage;
        }
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error buscando productos';
    } finally {
        loading.value = false;
    }
}

watch(search, () => {
    pagination.page = 1;
    if (t) clearTimeout(t);
    t = window.setTimeout(runSearch, SEARCH_DELAY_MS);
});
onUnmounted(() => { if (t) clearTimeout(t); });

watch(() => pagination.perPage, (newVal, oldVal) => {
    if (oldVal === undefined || newVal === oldVal) return;
    pagination.page = 1;
    if (t) { clearTimeout(t); t = undefined; }
    runSearch();
});

watch(() => pagination.page, (newVal, oldVal) => {
    if (oldVal === undefined || newVal === oldVal) return;
    if (t) { clearTimeout(t); t = undefined; }
    runSearch();
});

// ---------- Picking a product ----------
function pickProduct(p: PickedProduct) {
    const proveedorNombre = (p as any)?.proveedor?.nombre
        ?? (p as any)?.proveedor_nombre
        ?? '';
    selected.value = {
        ...p,
        precio: Number(p.precio),
        proveedor: p.proveedor ?? null,
        proveedor_nombre: proveedorNombre,
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

function goToPage(page: number) {
    const target = Math.max(1, Math.min(page, pagination.lastPage || 1));
    if (target === pagination.page) return;
    pagination.page = target;
}

function goToPrevPage() {
    goToPage(pagination.page - 1);
}

function goToNextPage() {
    goToPage(pagination.page + 1);
}

// Init
onMounted(() => { runSearch(); });
</script>

<template>
    <AppLayout>
        <div class="space-y-6">
            <!-- Search & results -->
            <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 md:p-6 space-y-4">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 class="text-xl font-semibold">Buscar producto</h2>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                        <span>Encuentra el producto y selecciónalo para actualizar inventario.</span>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="relative">
                        <input v-model="search" type="text" placeholder="Nombre, descripción, ident…"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2 pr-9"
                            aria-label="Buscar producto" />
                        <button v-if="search"
                            class="absolute inset-y-0 right-0 mr-2 my-1 px-2 text-sm text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
                            @click="search = ''; runSearch()" type="button" aria-label="Limpiar búsqueda">✕</button>
                    </div>
                    <p class="text-xs text-gray-500">Muestra los primeros 10 resultados que coincidan con la búsqueda.
                    </p>
                </div>

                <div class="border rounded-lg overflow-hidden">
                    <!-- Desktop table -->
                    <table class="hidden min-w-full text-sm md:table">
                        <thead class="bg-gray-50 text-gray-500">
                            <tr>
                                <th class="text-left font-medium px-3 py-2">ID</th>
                                <th class="text-left font-medium px-3 py-2">Ident</th>
                                <th class="text-left font-medium px-3 py-2">Producto</th>
                                <th class="text-left font-medium px-3 py-2">Proveedor</th>
                                <th class="text-left font-medium px-3 py-2">Existencia</th>
                                <th class="text-right font-medium px-3 py-2">Precio</th>
                                <th class="text-right font-medium px-3 py-2">Importe</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in results" :key="p.id" @click="pickProduct(p)"
                                :class="['cursor-pointer hover:bg-gray-50 transition', selected?.id === p.id ? 'bg-gray-100' : '']">
                                <td class="px-3 py-2">{{ p.id }}</td>
                                <td class="px-3 py-2">{{ p.ident }}</td>
                                <td class="px-3 py-2">{{ p.nombre }}</td>
                                <td class="px-3 py-2">{{ p.proveedor?.nombre }}</td>
                                <td class="px-3 py-2">{{ (p as any)?.inventario?.existencia ?? 0 }} unidades</td>
                                <td class="px-3 py-2 text-right">{{ money(p.precio) }}</td>
                                <td class="px-3 py-2 text-right">{{ money((p as any)?.inventario?.importe) }}</td>
                            </tr>
                            <tr v-if="!loading && results.length === 0">
                                <td colspan="7" class="px-3 py-3 text-center text-gray-500">Sin resultados</td>
                            </tr>
                            <tr v-if="loading">
                                <td colspan="7" class="px-3 py-3 text-center text-gray-500">Buscando…</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Mobile cards -->
                    <div class="md:hidden divide-y divide-gray-100 max-h-80 overflow-auto">
                        <button v-for="p in results" :key="p.id" @click="pickProduct(p)"
                            class="w-full text-left p-3 space-y-2 transition hover:bg-gray-50"
                            :class="selected?.id === p.id ? 'bg-gray-100' : 'bg-white'">
                            <div class="flex items-center justify-between">
                                <span class="text-sm font-semibold text-gray-800">{{ p.nombre }}</span>
                                <span class="text-xs text-gray-500">#{{ p.ident }}</span>
                            </div>
                            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                                <div><span class="font-medium text-gray-700">Proveedor:</span> {{
                                    p.proveedor?.nombre || '—'
                                    }}</div>
                                <div class="text-right"><span class="font-medium text-gray-700">Existencia:</span> {{
                                    (p as any)?.inventario?.existencia ?? 0 }} uds</div>
                                <div><span class="font-medium text-gray-700">Precio:</span>
                                    {{ money(p.precio) }}</div>
                                <div class="text-right"><span class="font-medium text-gray-700">Importe:</span>
                                    {{ money((p as any)?.inventario?.importe) }}</div>
                            </div>
                        </button>
                        <div v-if="!loading && results.length === 0" class="p-4 text-center text-sm text-gray-500">
                            Sin resultados
                        </div>
                        <div v-if="loading" class="p-4 text-center text-sm text-gray-500">Buscando…</div>
                    </div>
                </div>
                <div
                    class="flex flex-col gap-3 text-sm text-gray-600 md:flex-row md:items-center md:justify-between">
                    <div class="flex flex-wrap items-center gap-2">
                        <span>Filas por página:</span>
                        <select v-model.number="pagination.perPage"
                            class="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:ring-gray-900">
                            <option v-for="option in [5, 10, 20, 50]" :key="option" :value="option">{{ option }}</option>
                        </select>
                        <span v-if="pageInfo">Mostrando {{ pageInfo.start }} – {{ pageInfo.end }} de {{
                            pagination.total }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button @click="goToPrevPage" :disabled="pagination.page <= 1"
                            class="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
                            Anterior
                        </button>
                        <select v-model.number="pagination.page"
                            class="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:ring-gray-900">
                            <option v-for="pageNumber in pageNumbers" :key="pageNumber" :value="pageNumber">
                                Página {{ pageNumber }}
                            </option>
                        </select>
                        <button @click="goToNextPage" :disabled="pagination.page >= pagination.lastPage"
                            class="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
                            Siguiente
                        </button>
                    </div>
                </div>
            </section>

            <!-- Selected product / inventory actions -->
            <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 md:p-6 space-y-5">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 class="text-xl font-semibold">Entrada de inventario</h2>
                        <p class="text-xs text-gray-500 mt-1">Registra entradas o corrige el stock actual del producto
                            seleccionado.</p>
                    </div>
                    <div class="flex gap-2">
                        <button class="px-3 py-1.5 text-sm rounded-full"
                            :class="activeTab === 'entrada'
                                ? 'bg-gray-900 text-white shadow-sm'
                                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'"
                            @click="activeTab = 'entrada'" type="button">
                            Entrada
                        </button>
                        <button class="px-3 py-1.5 text-sm rounded-full"
                            :class="activeTab === 'correccion'
                                ? 'bg-gray-900 text-white shadow-sm'
                                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'"
                            @click="activeTab = 'correccion'" type="button">
                            Corrección SET
                        </button>
                    </div>
                </div>

                <div v-if="message"
                    class="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-2 text-sm">
                    {{ message }}
                </div>
                <div v-if="error"
                    class="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm">
                    {{ error }}
                </div>

                <div v-if="selected?.id" class="space-y-5">
                    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-start">
                            <div class="space-y-1">
                                <p class="text-sm text-gray-500 uppercase tracking-wide">Producto seleccionado</p>
                                <h3 class="text-lg font-semibold text-gray-900">{{ selected?.nombre }}</h3>
                                <p class="text-xs text-gray-500">Proveedor: {{ selected?.proveedor_nombre || '—' }}</p>
                            </div>
                            <div
                                class="grid grid-cols-2 gap-3 text-xs text-gray-600 md:grid-cols-3 md:gap-4 md:min-w-[280px]">
                                <div class="p-2 rounded-md bg-white border">
                                    <p class="text-[11px] uppercase text-gray-400">Ident</p>
                                    <p class="text-sm font-semibold text-gray-800">{{ String(selected?.ident).padStart(6,
                                        '0') }}</p>
                                </div>
                                <div class="p-2 rounded-md bg-white border">
                                    <p class="text-[11px] uppercase text-gray-400">Precio</p>
                                    <p class="text-sm font-semibold text-gray-800">{{ money(selected?.precio) }}</p>
                                </div>
                                <div class="p-2 rounded-md bg-white border">
                                    <p class="text-[11px] uppercase text-gray-400">Existencia</p>
                                    <p class="text-sm font-semibold text-gray-800">{{ currentStock }} uds</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Entrada tab -->
                    <div v-if="activeTab === 'entrada'" class="space-y-4">
                        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Cantidad a ingresar</label>
                                <input v-model.number="cantidad" type="number" min="0" step="1"
                                    class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                    placeholder="0" />
                            </div>
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Fecha de entrada</label>
                                <input v-model="entradaFecha" type="date"
                                    class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                            </div>
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Importe total</label>
                                <div class="h-[42px] flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3">
                                    <span class="text-sm text-gray-500">cantidad × precio</span>
                                    <span class="text-lg font-semibold text-[#E4007C]">{{
                                        money(totalImporte)
                                    }}</span>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button :disabled="saving || !selected?.id || !cantidad" @click="saveStock('add')"
                                class="rounded-lg bg-[#E4007C] hover:bg-[#cc006f] text-white px-4 py-2 text-sm disabled:opacity-60">
                                Guardar entrada + recibo
                            </button>
                            <button type="button" :disabled="!selected?.id || !cantidad" @click="makeReceiptPDF"
                                class="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
                                Generar recibo (PDF) sin guardar
                            </button>
                        </div>
                    </div>

                    <!-- Corrección tab -->
                    <div v-else class="space-y-4">
                        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Existencia actual</label>
                                <div
                                    class="h-[42px] flex items-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700">
                                    {{ currentStock }} unidades
                                </div>
                            </div>
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Existencia nueva</label>
                                <input v-model.number="newStock" type="number" min="0" step="1"
                                    class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                    placeholder="0" />
                            </div>
                            <div class="space-y-1">
                                <label class="block text-sm font-medium text-gray-700">Importe nuevo</label>
                                <div class="h-[42px] flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3">
                                    <span class="text-sm text-gray-500">existencia × precio</span>
                                    <span class="text-lg font-semibold text-[#E4007C]">{{ money(newImporte) }}</span>
                                </div>
                            </div>
                        </div>
                        <button :disabled="saving || newStock === null || newStock < 0" @click="saveStock('set')"
                            class="rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 text-sm disabled:opacity-60">
                            Actualizar inventario (SET)
                        </button>
                    </div>
                </div>

                <div v-else
                    class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
                    Selecciona un producto para comenzar a registrar entradas o correcciones.
                </div>
            </section>
        </div>
    </AppLayout>
</template>
