<script setup lang="ts">
import { fetchActivePromosFor, type Promo } from '../api/promocionescaja';
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import { cajaStatus, cajaOpen, cajaClose, findProduct, checkout, type CashMethod } from '../api/cashier';
import { jsPDF } from 'jspdf';

type Producto = {
    id: number;
    ident: number;
    nombre: string;
    descripcion?: string;
    precio: number;
    proveedorid: number;
    proveedor?: { id: number; nombre: string };
    inventario?: { existencia: number; importe: number };
};

type CartRow = {
    ident: number;
    nombre: string;
    precio: number;
    existencia: number;
    qty: number;
    proveedorid?: number;      // 👈 add this
    // promo annotations (computed on the fly)
    promoDiscountPct?: number;  // percent promo (from “descuento”)
    promoFreeQty?: number;      // free items from bundle (3x2, 2x1, etc.)
    promoNote?: string;         // UI note e.g. "Descuento 15%" or "3x2 aplicado (+1 gratis)"
};
// small helpers
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');

const caja = ref<{ open: boolean; caja: any | null }>({ open: false, caja: null });

// --- Search/scan ---
const query = ref('');
const results = ref<Producto[]>([]);
const SHOW_RESULTS = ref(false);
let searchTimer: number | undefined;
const promoCache = new Map<number, Promo[]>(); // key: producto ident

async function getPromosForRow(r: CartRow, proveedorIdent?: number) {
    if (promoCache.has(r.ident)) return promoCache.get(r.ident)!;
    const promos = await fetchActivePromosFor(r.ident, proveedorIdent);
    promoCache.set(r.ident, promos);
    return promos;
}

async function applyPromotionsToRow(r: CartRow, proveedorIdent?: number) {
    // reset annotations
    r.promoDiscountPct = 0;
    r.promoFreeQty = 0;
    r.promoNote = undefined;

    const promos = await getPromosForRow(r, proveedorIdent);
    if (!promos.length) return;

    // Prefer product-level over proveedor-level if both exist.
    const productPromos = promos.filter(p => p.proveedor === null);
    const providerPromos = promos.filter(p => p.proveedor != null);
    const candidates = productPromos.length ? productPromos : providerPromos;

    // Split by type
    const pctPromo = candidates.find(p => p.tipo === 'descuento' && (p.descuento ?? 0) > 0);
    const bundle = candidates.find(p => p.tipo === 'bundle' && (p.mincompra ?? 0) > 0 && (p.gratis ?? 0) > 0);
    let noteParts: string[] = [];

    if (pctPromo?.descuento) {
        r.promoDiscountPct = Number(pctPromo.descuento) || 0;
        noteParts.push(`Descuento ${r.promoDiscountPct}%`);
    }

    if (bundle?.mincompra && bundle?.gratis) {
        const min = Number(bundle.mincompra);
        const freeEach = Number(bundle.gratis);
        const bonus = Number(bundle.gratis);

        if (r.qty >= min) {
            // groups based on PAID qty (no freebies included yet)
            const groupsFromPaid = Math.floor(r.qty / min);
            let freebies = groupsFromPaid * freeEach;

            // Cap freebies so total (paid + free) doesn't exceed existencia
            const maxExtra = Math.max(0, r.existencia - r.qty);
            freebies = clamp(freebies, 0, maxExtra);

            // Apply freebies
            r.promoFreeQty = freebies;
            if (freebies > 0) {
                r.qty += freebies; // new cart quantity includes freebies
            }

            noteParts.push(`${min}x${min + freeEach} aplicado (+${r.promoFreeQty} gratis)`);
        } else {
            // Not enough to trigger bundle; ensure no freebies
            r.promoFreeQty = 0;
        }

    }

    if (noteParts.length) r.promoNote = noteParts.join(' · ');
}


async function doSearch() {
    if (!query.value) { results.value = []; return; }
    loading.value = true; error.value = '';
    try {
        const isBarcode = /^\d+$/.test(query.value.trim());
        const data = await findProduct(isBarcode ? { barcode: Number(query.value) } : { search: query.value, per_page: 20 });
        results.value = data;
        SHOW_RESULTS.value = true;
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo buscar';
    } finally {
        loading.value = false;
    }
}
function debouncedSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(doSearch, 250);
}
onUnmounted(() => searchTimer && clearTimeout(searchTimer));

// --- Scan via USB (enters code + Enter) ---
function handleKeydown(e: KeyboardEvent) {
    // if focused in inputs, ignore
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    // capture numeric stream until Enter
    if (!scanActive.value && /^\d$/.test(e.key)) {
        scanActive.value = true;
        scanBuffer.value = e.key;
        scanTimer = window.setTimeout(resetScan, 500); // timeout window
        e.preventDefault();
        return;
    }

    if (scanActive.value) {
        if (e.key === 'Enter') {
            const code = scanBuffer.value;
            resetScan();
            query.value = code;
            // instantly try to add to cart
            addFirstMatchFromBarcode(code);
            e.preventDefault();
            return;
        }
        if (/^\d$/.test(e.key)) {
            scanBuffer.value += e.key;
            if (scanTimer) { clearTimeout(scanTimer); scanTimer = window.setTimeout(resetScan, 500); }
            e.preventDefault();
            return;
        }
    }
}
const scanActive = ref(false);
const scanBuffer = ref('');
let scanTimer: number | undefined;
function resetScan() {
    scanActive.value = false;
    scanBuffer.value = '';
    if (scanTimer) clearTimeout(scanTimer);
}
async function addFirstMatchFromBarcode(code: string) {
    try {
        const rows = await findProduct({ barcode: Number(code) });
        if (rows?.length) addToCart(rows[0]);
    } catch { }
}

onMounted(async () => {
    await refreshCaja();
    window.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

// --- Cart ---
const cart = ref<CartRow[]>([]);
async function addToCart(p: Producto) {
    SHOW_RESULTS.value = false;
    query.value = '';

    const row = cart.value.find(r => r.ident === p.ident);
    const max = Number(p?.inventario?.existencia ?? 0);

    if (row) {
        if (row.qty < max) row.qty++;
        // re-run promos to catch bundle freebies (discount won't change, but fine)
        await applyPromotionsToRow(row, p.proveedorid);
        return;
    }

    // Build the row but DO NOT insert yet
    const newRow: CartRow = {
        ident: p.ident,
        nombre: p.nombre,
        precio: Number(p.precio),
        existencia: max,
        qty: max > 0 ? 1 : 0,
        proveedorid: p.proveedorid,
    };

    // Apply promos first so discount is present on first render
    await applyPromotionsToRow(newRow, p.proveedorid);

    // Now insert already-annotated row
    cart.value.unshift(newRow);
}

async function onQtyChange(r: CartRow, proveedorId?: number) {
    clampQty(r);
    await applyPromotionsToRow(r, r.proveedorid);
}

function removeFromCart(ident: number) {
    cart.value = cart.value.filter(r => r.ident !== ident);
}
function clampQty(r: CartRow) {
    r.qty = Math.trunc(Number(r.qty) || 0);

    if (r.qty < 0) r.qty = 0;
    if (r.qty > r.existencia) r.qty = r.existencia;
}

const discountPercent = ref<number>(0);
const paymentMethod = ref<CashMethod>('cash');
const cashReceived = ref<number | null>(null);

const subTotal = computed(() => cart.value.reduce((s, r) => s + r.precio * r.qty, 0));


const changeDue = computed(() => {
    if (paymentMethod.value !== 'cash') return 0;
    const recv = Number(cashReceived.value ?? 0);
    return Math.max(0, Math.round((recv - total.value) * 100) / 100);
});

function currency(n: number, currency = 'MXN', locale = 'es-MX') {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
}

// --- Caja controls ---
async function refreshCaja() {
    const data = await cajaStatus();
    caja.value = data ?? { open: false, caja: null };
}
const openAmount = ref<number | null>(null);
async function openCaja() {
    error.value = ''; message.value = '';
    if (openAmount.value == null || openAmount.value < 0) { error.value = 'Saldo inicial inválido'; return; }
    saving.value = true;
    try {
        console.log('Abriendo caja con saldo:', openAmount.value);
        await cajaOpen({ saldoinicial: Number(openAmount.value) });
        message.value = 'Caja abierta';
        await refreshCaja();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo abrir caja';
    } finally { saving.value = false; }
}

const closeAmount = ref<number | null>(null);
async function closeCaja() {
    error.value = ''; message.value = '';
    saving.value = true;
    try {
        // If you want auto-calc, send empty payload. If you want manual, send { saldofinal: Number(closeAmount.value) }
        const payload = closeAmount.value != null ? { saldofinal: Number(closeAmount.value) } : undefined;
        const res = await cajaClose(payload);
        message.value = 'Caja cerrada';
        await refreshCaja();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo cerrar caja';
    } finally { saving.value = false; }
}

// --- Checkout ---
async function onCheckout() {
    error.value = ''; message.value = '';
    if (!caja.value.open) { error.value = 'Abre caja antes de vender'; return; }

    const items = cart.value.filter(r => r.qty > 0).map(r => ({ ident: r.ident, qty: r.qty }));
    if (!items.length) { error.value = 'Carrito vacío'; return; }

    if (paymentMethod.value === 'cash') {
        const recv = Number(cashReceived.value ?? 0);
        if (recv < total.value) { error.value = 'Efectivo recibido insuficiente'; return; }
    }

    saving.value = true;
    try {
        const payload = {
            items,
            // 👇 this represents both manual % discount and promo discounts (percent + freebies)
            discount_percent: effectiveDiscountPercentForBE.value,
            payment: {
                method: paymentMethod.value,
                ...(paymentMethod.value === 'cash' ? { received: Number(cashReceived.value ?? 0) } : {})
            }
        };
        const res = await checkout(payload);
        console.log('Venta realizada, idventaEST:', res);

        if (res?.data.venta.idventa) {
            console.log('Venta realizada, idventa:', res.idventa);
            await makeReceiptPDFFromSale(res.idventa, { fecha: new Date().toISOString().slice(0,10) });
        }
        message.value = 'Venta realizada con promociones aplicadas';

        cart.value = [];
        discountPercent.value = 0;
        cashReceived.value = null;
        await refreshCaja();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo terminar la venta';
    } finally {
        saving.value = false;
    }
}
//descuentos
// Promo discount amount per line
function linePromoDiscount(r: CartRow) {
    const percent = (r.promoDiscountPct ?? 0) / 100;
    const percentDiscount = r.precio * r.qty * percent;
    const bundleDiscount = r.precio * (r.promoFreeQty ?? 0); // free units valued at unit price
    return Math.round((percentDiscount + bundleDiscount) * 100) / 100;
}

// Sum of promo discounts
const promoDiscountAmount = computed(() =>
    Math.round(cart.value.reduce((sum, r) => sum + linePromoDiscount(r), 0) * 100) / 100
);

// Your user-entered discount:
const discountAmount = computed(() =>
    Math.round((subTotal.value * (discountPercent.value || 0) / 100) * 100) / 100
);

// Merge: an equivalent global percent for backend
const totalDiscountAmount = computed(() => discountAmount.value + promoDiscountAmount.value);
const effectiveDiscountPercentForBE = computed(() => {
    if (subTotal.value <= 0) return 0;
    return Math.round((totalDiscountAmount.value / subTotal.value) * 10000) / 100; // 2 decimals
});

// Now recompute downstream totals using merged amount:
const afterDiscount = computed(() => Math.max(0, subTotal.value - totalDiscountAmount.value));
const surchargePercent = computed(() => paymentMethod.value === 'credit' ? 4.5 : 0);
const surchargeAmount = computed(() => Math.round((afterDiscount.value * surchargePercent.value / 100) * 100) / 100);
const total = computed(() => Math.round((afterDiscount.value + surchargeAmount.value) * 100) / 100);



function money(n: number, currency = 'MXN', locale = 'es-MX') {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
}

// same logic you already use to compute per-line promo discount:
function linePromoDiscountPDF(r: CartRow) {
    const percent = (r.promoDiscountPct ?? 0) / 100;
    const percentDiscount = r.precio * r.qty * percent;
    const bundleDiscount = r.precio * (r.promoFreeQty ?? 0);
    return Math.round((percentDiscount + bundleDiscount) * 100) / 100;
}

async function makeReceiptPDFFromSale(idventa: number, opts?: { fecha?: string }) {
    // pull data from your current reactive state
    const rows = cart.value.slice(); // snapshot
    const fecha = opts?.fecha ?? new Date().toISOString().slice(0, 10);

    // totals you already compute:
    const _subtotal = rows.reduce((s, r) => s + (r.precio * r.qty), 0);
    const _promoDisc = rows.reduce((s, r) => s + linePromoDiscount(r), 0);      // promos (bundle + %)
    const _manualDisc = Math.round((_subtotal * (discountPercent.value || 0) / 100) * 100) / 100;
    const _afterDisc = Math.max(0, _subtotal - _promoDisc - _manualDisc);
    const _surchargePct = (paymentMethod.value === 'credit') ? 4.5 : 0;
    const _surcharge = Math.round((_afterDisc * _surchargePct / 100) * 100) / 100;
    const _total = Math.round((_afterDisc + _surcharge) * 100) / 100;
    const _received = paymentMethod.value === 'cash' ? Number(cashReceived.value ?? 0) : _total;
    const _change = paymentMethod.value === 'cash' ? Math.max(0, Math.round((_received - _total) * 100) / 100) : 0;

    const doc = new jsPDF({ unit: 'mm', format: 'a5' }); // small ticket; change to 'letter' if you prefer
    let y = 12;

    // Header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('ROSAMEXICANO', 14, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Ticket #${idventa}`, 14, y); y += 5;
    doc.text(`Fecha: ${fecha}`, 14, y); y += 5;
    if (caja.value?.caja?.usuario) { doc.text(`Vendedor: ${caja.value.caja.usuario}`, 14, y); y += 6; }

    // Table header
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.text('Prod.', 14, y);
    doc.text('Cant', 90, y, { align: 'right' });
    doc.text('P.Unit', 120, y, { align: 'right' });
    doc.text('Desc', 150, y, { align: 'right' });
    doc.text('Importe', 190, y, { align: 'right' });
    y += 2;
    doc.setDrawColor(200); doc.line(14, y, 190, y);
    y += 5;
    doc.setFont('helvetica', 'normal');

    // Lines
    rows.forEach(r => {
        const maxWidth = 70; // mm for product name column
        const name = doc.splitTextToSize(r.nombre, maxWidth);
        const lineDiscount = linePromoDiscount(r);
        const lineGross = r.precio * r.qty;
        const lineNet = Math.max(0, lineGross - lineDiscount);

        // first line with numbers
        doc.text(String(name[0]), 14, y);
        doc.text(String(r.qty), 90, y, { align: 'right' });
        doc.text(money(r.precio), 120, y, { align: 'right' });
        doc.text(lineDiscount > 0 ? `-${money(lineDiscount)}` : '—', 150, y, { align: 'right' });
        doc.text(money(lineNet), 190, y, { align: 'right' });
        y += 5;

        // wrap extra name lines
        for (let i = 1; i < name.length; i++) {
            doc.text(String(name[i]), 14, y);
            y += 5;
        }
        // promo note
        if (r.promoNote) {
            doc.setTextColor(0, 128, 96);
            doc.setFontSize(9);
            doc.text(`• ${r.promoNote}`, 14, y);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            y += 4;
        }

        // page break if very close to bottom
        if (y > 260) { doc.addPage('a5', 'portrait'); y = 12; }
    });

    // Totals
    y += 2; doc.line(14, y, 190, y); y += 5;
    const row = (label: string, value: string, bold = false) => {
        if (bold) { doc.setFont('helvetica', 'bold'); }
        doc.text(label, 14, y);
        doc.text(value, 190, y, { align: 'right' });
        if (bold) { doc.setFont('helvetica', 'normal'); }
        y += 6;
    }
    row('Subtotal', money(_subtotal));
    if (_promoDisc) row('Promociones', `- ${money(_promoDisc)}`);
    if (_manualDisc) row('Descuento manual', `- ${money(_manualDisc)}`);
    if (_surcharge) row(`Recargo ${_surchargePct}%`, money(_surcharge));
    row('Total', money(_total), true);

    // Payment
    y += 2; doc.line(14, y, 190, y); y += 6;
    row('Método de pago', paymentMethod.value.toUpperCase());
    row('Recibido', money(_received));
    row('Cambio', money(_change));

    y += 4;
    doc.setFontSize(9);
    doc.text('¡Gracias por su compra!', 100, y, { align: 'center' });

    doc.save(`ticket_${idventa}.pdf`);
}

</script>

<template>
    <AppLayout>
        <div class="space-y-4">

            <!-- Caja banner -->
            <div v-if="caja.open"
                class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between">
                <div class="text-emerald-800 text-sm">
                    <b>Caja abierta</b>
                    <span v-if="caja.caja?.saldoinicial"> · Saldo inicial: {{ currency(Number(caja.caja.saldoinicial))
                        }}</span>
                    <span v-if="caja.caja?.usuario"> · Por: {{ caja.caja.usuario }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <input v-model.number="closeAmount" type="number" step="0.01" placeholder="Saldo sistema (opcional)"
                        class="rounded border px-2 py-1 text-sm">
                    <button :disabled="saving" @click="closeCaja"
                        class="rounded bg-rose-600 hover:bg-rose-700 text-white text-sm px-3 py-1.5">Cerrar
                        caja</button>
                </div>
            </div>

            <div v-else class="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between">
                <div class="text-amber-800 text-sm">
                    <b>Caja cerrada</b> · Abre para poder vender
                </div>
                <div class="flex items-center gap-2">
                    <input v-model.number="openAmount" type="number" step="0.01" placeholder="Saldo inicial"
                        class="rounded border px-2 py-1 text-sm">
                    <button :disabled="saving || openAmount == null" @click="openCaja"
                        class="rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5">Abrir
                        caja</button>
                </div>
            </div>

            <!-- Alerts -->
            <div v-if="message"
                class="rounded border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2">
                {{ message }}
            </div>
            <div v-if="error" class="rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm px-3 py-2">
                {{ error }}
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <!-- Left: Search / Results -->
                <div class="lg:col-span-2 space-y-3">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Buscar / Escanear</label>
                        <input v-model="query" @input="debouncedSearch" type="text"
                            placeholder="Nombre, ident, proveedor…"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                        <p class="text-xs text-gray-500 mt-1">Escáner USB: apunte al input o presione Enter al final del
                            código.</p>
                    </div>

                    <div v-if="SHOW_RESULTS" class="border rounded-lg max-h-64 overflow-auto">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 text-gray-500">
                                <tr>
                                    <th class="text-left font-medium px-3 py-2">Ident</th>
                                    <th class="text-left font-medium px-3 py-2">Producto</th>
                                    <th class="text-right font-medium px-3 py-2">Precio</th>
                                    <th class="text-right font-medium px-3 py-2">Existencia</th>
                                    <th class="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in results" :key="p.id" class="hover:bg-gray-50">
                                    <td class="px-3 py-2">{{ p.ident }}</td>
                                    <td class="px-3 py-2">{{ p.nombre }}</td>
                                    <td class="px-3 py-2 text-right">{{ new
                                        Intl.NumberFormat('es-MX', {
                                            style:
                                                'currency', currency: 'MXN'
                                        }).format(Number(p.precio))
                                    }}</td>
                                    <td class="px-3 py-2 text-right">{{ Number(p?.inventario?.existencia ?? 0) }}</td>
                                    <td class="px-3 py-2 text-right">
                                        <button @click="addToCart(p)"
                                            class="rounded border px-2 py-1 text-sm hover:bg-gray-100">Agregar</button>
                                    </td>
                                </tr>
                                <tr v-if="!loading && results.length === 0">
                                    <td colspan="5" class="px-3 py-3 text-center text-gray-500">Sin resultados</td>
                                </tr>
                                <tr v-if="loading">
                                    <td colspan="5" class="px-3 py-3 text-center text-gray-500">Buscando…</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Cart -->
                    <div class="border rounded-lg">
                        <div class="px-3 py-2 border-b text-sm font-medium">Carrito</div>
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 text-gray-500">
                                <tr>
                                    <th class="text-left font-medium px-3 py-2">Ident</th>
                                    <th class="text-left font-medium px-3 py-2">Producto</th>
                                    <th class="text-right font-medium px-3 py-2">P. Unit.</th>
                                    <th class="text-right font-medium px-3 py-2">Exist.</th>
                                    <th class="text-right font-medium px-3 py-2">Cantidad</th>
                                    <th class="text-right font-medium px-3 py-2">Importe</th>
                                    <th class="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="r in cart" :key="r.ident" class="align-middle">
                                    <td class="px-3 py-2">{{ r.ident }}</td>
                                    <td class="px-3 py-2">
                                        <div>{{ r.nombre }}</div>
                                        <div v-if="r.promoNote" class="text-xs text-emerald-700">
                                            {{ r.promoNote }}
                                        </div>
                                    </td>
                                    <td class="px-3 py-2 text-right">{{ currency(r.precio) }}</td>
                                    <td class="px-3 py-2 text-right">{{ r.existencia }}</td>
                                    <td class="px-3 py-2 text-right">
                                        <input v-model.number="r.qty" @change="onQtyChange(r)" type="number" min="0"
                                            :max="r.existencia" class="w-20 rounded border px-2 py-1 text-right" />
                                        <div v-if="(r.promoFreeQty ?? 0) > 0" class="text-xs text-gray-500">
                                            Cobrar: {{ Math.max(0, r.qty - (r.promoFreeQty ?? 0)) }}
                                        </div>
                                    </td>
                                    <td class="px-3 py-2 text-right">
                                        {{ new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
                                            .format(r.precio * Math.max(0, r.qty - (r.promoFreeQty ?? 0)) * (1 -
                                                (r.promoDiscountPct ?? 0) / 100)) }}
                                    </td>
                                    <td class="px-3 py-2 text-right">
                                        <button @click="removeFromCart(r.ident)"
                                            class="rounded border px-2 py-1 text-sm hover:bg-gray-100">Quitar</button>
                                    </td>
                                </tr>
                                <tr v-if="cart.length === 0">
                                    <td colspan="7" class="px-3 py-6 text-center text-gray-500">No hay productos en el
                                        carrito</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Right: Totals & Payment -->
                <div class="lg:col-span-1 space-y-4">
                    <div class="border rounded-lg p-3 space-y-3">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Descuento (%)</label>
                            <input v-model.number="discountPercent" type="number" step="0.5" min="0" max="100"
                                class="w-full rounded-lg border px-3 py-2" />
                        </div>

                        <div class="text-sm space-y-1">
                            <div class="flex justify-between"><span>Subtotal</span><b>{{ currency(subTotal) }}</b></div>
                            <div class="flex justify-between" v-if="promoDiscountAmount">
                                <span>Promociones</span><b class="text-emerald-700">- {{ currency(promoDiscountAmount)
                                }}</b>
                            </div>
                            <div class="flex justify-between"><span>Descuento manual</span><b>- {{
                                currency(discountAmount) }}</b></div>
                            <div class="flex justify-between"><span>Recargo {{ surchargePercent ?
                                `(${surchargePercent}%)` : '' }}</span><b>{{ currency(surchargeAmount) }}</b></div>
                            <div class="flex justify-between text-lg"><span>Total</span><b>{{ currency(total) }}</b>
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Método de pago</label>
                            <div class="flex gap-2">
                                <button @click="paymentMethod = 'cash'"
                                    :class="['px-3 py-1.5 rounded border text-sm', paymentMethod === 'cash' ? 'bg-gray-900 text-white' : '']">Efectivo</button>
                                <button @click="paymentMethod = 'debit'"
                                    :class="['px-3 py-1.5 rounded border text-sm', paymentMethod === 'debit' ? 'bg-gray-900 text-white' : '']">Débito</button>
                                <button @click="paymentMethod = 'credit'"
                                    :class="['px-3 py-1.5 rounded border text-sm', paymentMethod === 'credit' ? 'bg-gray-900 text-white' : '']">Crédito</button>
                            </div>
                        </div>

                        <div v-if="paymentMethod === 'cash'">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Efectivo recibido</label>
                            <input v-model.number="cashReceived" type="number" step="0.01" min="0"
                                class="w-full rounded-lg border px-3 py-2" />
                            <div class="mt-2 text-sm text-gray-700 flex justify-between">
                                <span>Cambio</span><b>{{ currency(changeDue) }}</b>
                            </div>
                        </div>

                        <button :disabled="saving || !caja.open || cart.length === 0" @click="onCheckout"
                            class="w-full rounded-lg bg-[#E4007C] hover:bg-[#cc006f] text-white px-4 py-2 disabled:opacity-60">
                            Cobrar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
