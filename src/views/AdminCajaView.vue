<script setup lang="ts">
/**
 * AdminCajaView renders the point-of-sale interface for cashiers.
 * It centralizes cart management, promotions, checkout, and manual expense logging.
 */
import { fetchActivePromosFor, type Promo } from '../api/promocionescaja';
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import {
    cajaStatus,
    cajaOpen,
    cajaClose,
    findProduct,
    checkout,
    sendSaleTicket,
    registerExpense,
    type CashMethod,
    type CashMovementPayload
} from '../api/cashier';
import { searchClientes, createCliente, type Cliente } from '../api/clientes';
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
    proveedorname?: string;
    proveedorid?: number;
    promoDiscountPct?: number;
    promoFreeQty?: number;
    promoNote?: string;
};

type SaleSnapshot = {
    idventa: number;
    fecha: string;
    rows: CartRow[];
    subtotal: number;
    promoDiscount: number;
    manualDiscount: number;
    totalDiscount: number;
    afterDiscount: number;
    surchargePercent: number;
    surchargeAmount: number;
    total: number;
    paymentMethod: CashMethod;
    cashReceived: number;
    change: number;
};

// Reactive state -------------------------------------------------
const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');
const ALERT_TIMEOUT_MS = 5000;
let messageTimer: number | undefined;
let errorTimer: number | undefined;

const caja = ref<{ open: boolean; caja: any | null }>({ open: false, caja: null });

const query = ref('');
const results = ref<Producto[]>([]);
const SHOW_RESULTS = ref(false);
let searchTimer: number | undefined;

const scanActive = ref(false);
const scanBuffer = ref('');
let scanTimer: number | undefined;

const cart = ref<CartRow[]>([]);

// Expense modal state -------------------------------------------------------
const showExpenseModal = ref(false);
const expenseSaving = ref(false);
const expenseError = ref('');
const expenseForm = reactive({
    concepto: '',
    total: null as number | null,
    fecha: todayISO(),
});

const lastSaleSnapshot = ref<SaleSnapshot | null>(null);
const showTicketModal = ref(false);
const ticketSendChannel = ref<'email' | 'sms'>('email');
const ticketSending = ref(false);
const clientSearch = ref('');
const clientSuggestions = ref<Cliente[]>([]);
const clientSearchLoading = ref(false);
const clientSelection = ref<Cliente | null>(null);
const clientForm = reactive({ nombre: '', email: '', telefono: '' });
const clientSaving = ref(false);
const clientMessage = ref('');
const clientError = ref('');
let clientSearchTimer: number | undefined;
const clientSearchNoResults = ref(false);

const discountPercent = ref<number>(0);
const paymentMethod = ref<CashMethod>('efectivo');
const cashReceived = ref<number | null>(null);

// Cash drawer amounts -------------------------------------------------------
const openAmount = ref<number | null>(null);
const closeAmount = ref<number | null>(null);

// Derived state & constants --------------------------------------
/** Memoizes promotions per product to avoid redundant API requests during cart edits. */
const promoCache = new Map<number, Promo[]>();
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const linePromoDiscount = (row: CartRow) => {
    const percent = (row.promoDiscountPct ?? 0) / 100;
    const percentDiscount = row.precio * row.qty * percent;
    const bundleDiscount = row.precio * (row.promoFreeQty ?? 0);
    return Math.round((percentDiscount + bundleDiscount) * 100) / 100;
};

/** Raw total before discounts or surcharges. */
const subTotal = computed(() => cart.value.reduce((sum, row) => sum + row.precio * row.qty, 0));

/** Sum of all promo-related discounts (percent and freebies). */
const promoDiscountAmount = computed(() =>
    Math.round(cart.value.reduce((sum, row) => sum + linePromoDiscount(row), 0) * 100) / 100
);

/** Cashier-entered manual percent discount applied to the entire cart. */
const discountAmount = computed(() =>
    Math.round((subTotal.value * (discountPercent.value || 0) / 100) * 100) / 100
);

const totalDiscountAmount = computed(() => discountAmount.value + promoDiscountAmount.value);

const effectiveDiscountPercentForBE = computed(() => {
    if (subTotal.value <= 0) return 0;
    return Math.round((totalDiscountAmount.value / subTotal.value) * 10000) / 100;
});

/** Net total after discounts but before card surcharge is applied. */
const afterDiscount = computed(() => Math.max(0, subTotal.value - totalDiscountAmount.value));
/** Surcharge only applies to credit card operations; currently a fixed 4.5%. */
const surchargePercent = computed(() => paymentMethod.value === 'credit' ? 4.5 : 0);
const surchargeAmount = computed(() => Math.round((afterDiscount.value * surchargePercent.value / 100) * 100) / 100);
const total = computed(() => Math.round((afterDiscount.value + surchargeAmount.value) * 100) / 100);

const changeDue = computed(() => {
    if (paymentMethod.value !== 'efectivo') return 0;
    const received = Number(cashReceived.value ?? 0);
    return Math.max(0, Math.round((received - total.value) * 100) / 100);
});

// Functions ------------------------------------------------------
function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatToDMY(dateStr?: string) {
    const fallback = () => {
        const now = new Date();
        return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
    };
    if (!dateStr) return fallback();

    const [year = '', month = '', day = ''] = dateStr.split('-');
    if (!year || !month || !day) return fallback();

    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year.slice(-2)}`;
}

function resetExpenseForm() {
    expenseForm.concepto = '';
    expenseForm.total = null;
    expenseForm.fecha = todayISO();
}

function currency(amount: number, currencyCode = 'MXN', locale = 'es-MX') {
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(amount);
    } catch {
        return `$${amount.toFixed(2)}`;
    }
}

/** Utility helpers to manage transient success/error banners. */
function clearMessage() {
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = undefined;
    message.value = '';
}

function clearError() {
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = undefined;
    error.value = '';
}

function resetAlerts() {
    clearMessage();
    clearError();
}

function showMessage(text: string) {
    clearMessage();
    message.value = text;
    messageTimer = window.setTimeout(() => {
        clearMessage();
    }, ALERT_TIMEOUT_MS);
}

function showError(text: string) {
    clearError();
    error.value = text;
    errorTimer = window.setTimeout(() => {
        error.value = '';
        errorTimer = undefined;
    }, ALERT_TIMEOUT_MS);
}

function clearTicketState() {
    if (clientSearchTimer) {
        clearTimeout(clientSearchTimer);
        clientSearchTimer = undefined;
    }
    ticketSending.value = false;
    clientSearch.value = '';
    clientSuggestions.value = [];
    clientSelection.value = null;
    clientForm.nombre = '';
    clientForm.email = '';
    clientForm.telefono = '';
    clientMessage.value = '';
    clientError.value = '';
    clientSaving.value = false;
    clientSearchNoResults.value = false;
}

function openTicketModal(snapshot: SaleSnapshot) {
    console.log('Opening ticket modal for sale', snapshot);
    lastSaleSnapshot.value = snapshot;
    ticketSendChannel.value = 'email';
    clearTicketState();
    showTicketModal.value = true;
}

function closeTicketModal() {
    showTicketModal.value = false;
    clearTicketState();
    lastSaleSnapshot.value = null;
}

function applyClientSuggestion(cliente: Cliente) {
    clientSelection.value = cliente;
    clientForm.nombre = cliente?.nombre ?? '';
    clientForm.email = cliente?.email ?? '';
    clientForm.telefono = cliente?.telefono ?? '';
    clientSearch.value = cliente?.nombre ?? '';
    clientSuggestions.value = [];
    clientSearchNoResults.value = false;
}

function resetClientForm() {
    clientSelection.value = null;
    clientForm.nombre = '';
    clientForm.email = '';
    clientForm.telefono = '';
    clientSearch.value = '';
    clientSuggestions.value = [];
    clientMessage.value = '';
    clientError.value = '';
    clientSearchNoResults.value = false;
}

function selectClientSuggestion(cliente: Cliente) {
    applyClientSuggestion(cliente);
}

function captureSaleSnapshot(ventaId: number, sourceRows: CartRow[] = cart.value): SaleSnapshot {
    return {
        idventa: ventaId,
        fecha: new Date().toISOString().slice(0, 10),
        rows: sourceRows.map(row => ({ ...row })),
        subtotal: subTotal.value,
        promoDiscount: promoDiscountAmount.value,
        manualDiscount: discountAmount.value,
        totalDiscount: totalDiscountAmount.value,
        afterDiscount: afterDiscount.value,
        surchargePercent: surchargePercent.value,
        surchargeAmount: surchargeAmount.value,
        total: total.value,
        paymentMethod: paymentMethod.value,
        cashReceived: paymentMethod.value === 'efectivo' ? Number(cashReceived.value ?? 0) : total.value,
        change: paymentMethod.value === 'efectivo' ? changeDue.value : 0,
    };
}

async function saveCliente() {
    clientError.value = '';
    clientMessage.value = '';
    const nombre = clientForm.nombre.trim();
    const email = clientForm.email.trim();
    const telefono = clientForm.telefono.trim();

    if (!nombre) {
        clientError.value = 'Nombre del cliente requerido';
        return;
    }
    if (ticketSendChannel.value === 'email' && !email) {
        clientError.value = 'Correo electrónico requerido para enviar ticket por email';
        return;
    }
    if (ticketSendChannel.value === 'sms' && !telefono) {
        clientError.value = 'Teléfono requerido para enviar ticket por SMS';
        return;
    }

    clientSaving.value = true;
    try {
        const payload = { nombre, email: email || null, telefono: telefono || null };
        const saved = await createCliente(payload);
        const cliente = saved?.data ?? saved;
        applyClientSuggestion({
            id: cliente?.id ?? clientSelection.value?.id ?? 0,
            nombre: cliente?.nombre ?? nombre,
            email: cliente?.email ?? payload.email ?? '',
            telefono: cliente?.telefono ?? payload.telefono ?? '',
        });
        clientMessage.value = 'Cliente guardado';
    } catch (e: any) {
        clientError.value = e?.response?.data?.message || 'No se pudo guardar cliente';
    } finally {
        clientSaving.value = false;
    }
}

async function sendTicket() {
    clientError.value = '';
    clientMessage.value = '';
    const snapshot = lastSaleSnapshot.value;
    if (!snapshot) {
        clientError.value = 'No hay ticket para enviar';
        return;
    }

    const nombre = clientForm.nombre.trim();
    const email = clientForm.email.trim();
    const telefono = clientForm.telefono.trim();

    if (!nombre) {
        clientError.value = 'Nombre del cliente requerido';
        return;
    }

    if (ticketSendChannel.value === 'email') {
        if (!email) {
            clientError.value = 'Proporciona un correo electrónico válido';
            return;
        }
    } else {
        if (!telefono) {
            clientError.value = 'Proporciona un número de teléfono válido';
            return;
        }
    }

    ticketSending.value = true;
    try {
        let ticketPdfBase64: string | undefined;
        if (ticketSendChannel.value === 'email') {
            const doc = buildReceiptPDF(snapshot);
            const dataUri = doc.output('datauristring');
            ticketPdfBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        }
        await sendSaleTicket({
            venta_id: snapshot.idventa,
            canal: ticketSendChannel.value,
            cliente: {
                nombre,
                email: email || null,
                telefono: telefono || null,
            },
            ticket_pdf_base64: ticketPdfBase64,
        });

        const successText = ticketSendChannel.value === 'email'
            ? `Ticket enviado a ${email}`
            : `Ticket enviado vía SMS a ${telefono}`;
        showMessage(successText);
        closeTicketModal();
    } catch (e: any) {
        console.log('Error sending ticket:', e);
        clientError.value = e?.response?.data?.message || 'No se pudo enviar el ticket';
    } finally {
        ticketSending.value = false;
    }
}

function onPrintTicket() {
    const snapshot = lastSaleSnapshot.value;
    if (!snapshot) return;
    makeReceiptPDFFromSale(snapshot);
    closeTicketModal();
}

watch(clientSearch, (val) => {
    if (!showTicketModal.value) return;
    const raw = val ?? '';
    const trimmed = raw.trim();
    clientForm.nombre = raw;
    if (clientSearchTimer) {
        clearTimeout(clientSearchTimer);
        clientSearchTimer = undefined;
    }
    clientError.value = '';
    clientSearchNoResults.value = false;
    if (!trimmed) {
        clientSuggestions.value = [];
        return;
    }
    if (trimmed.length < 2) {
        clientSuggestions.value = [];
        return;
    }
    const term = trimmed;
    clientSearchTimer = window.setTimeout(async () => {
        clientSearchLoading.value = true;
        try {
            const resp = await searchClientes({ search: term, limit: 8 });
            const rows = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);
            if (clientSearch.value.trim() !== term) return;
            clientSuggestions.value = rows;
            clientSearchNoResults.value = term.length >= 5 && rows.length === 0;
        } catch (e: any) {
            clientError.value = e?.response?.data?.message || 'No se pudo buscar clientes';
            clientSearchNoResults.value = false;
        } finally {
            clientSearchLoading.value = false;
        }
    }, 350);
});

async function getPromosForRow(row: CartRow, proveedorIdent?: number) {
    if (promoCache.has(row.ident)) return promoCache.get(row.ident)!;
    const promos = await fetchActivePromosFor(row.ident, proveedorIdent);
    promoCache.set(row.ident, promos);
    return promos;
}

async function applyPromotionsToRow(row: CartRow, proveedorIdent?: number) {
    row.promoDiscountPct = 0;
    row.promoFreeQty = 0;
    row.promoNote = undefined;

    const promos = await getPromosForRow(row, proveedorIdent);
    if (!promos.length) return;

    const productPromos = promos.filter(p => p.proveedor === null);
    const providerPromos = promos.filter(p => p.proveedor != null);
    const candidates = productPromos.length ? productPromos : providerPromos;

    const pctPromo = candidates.find(p => p.tipo === 'descuento' && (p.descuento ?? 0) > 0);
    const bundle = candidates.find(p => p.tipo === 'bundle' && (p.mincompra ?? 0) > 0 && (p.gratis ?? 0) > 0);
    const noteParts: string[] = [];

    if (pctPromo?.descuento) {
        row.promoDiscountPct = Number(pctPromo.descuento) || 0;
        noteParts.push(`Descuento ${row.promoDiscountPct}%`);
    }

    if (bundle?.mincompra && bundle?.gratis) {
        const min = Number(bundle.mincompra);
        const freeEach = Number(bundle.gratis);

        if (row.qty >= min) {
            const groupsFromPaid = Math.floor(row.qty / min);
            let freebies = groupsFromPaid * freeEach;

            const maxExtra = Math.max(0, row.existencia - row.qty);
            freebies = clamp(freebies, 0, maxExtra);

            row.promoFreeQty = freebies;
            if (freebies > 0) {
                row.qty += freebies;
            }

            noteParts.push(`${min}x${min + freeEach} aplicado (+${row.promoFreeQty} gratis)`);
        } else {
            row.promoFreeQty = 0;
        }
    }

    if (noteParts.length) row.promoNote = noteParts.join(' · ');
}

/** Runs the remote search and handles loading/errors for the quick lookup list. */
async function doSearch() {
    if (!query.value) { results.value = []; return; }
    loading.value = true;
    clearError();
    try {
        const isBarcode = /^\d+$/.test(query.value.trim());
        const data = await findProduct(isBarcode ? { barcode: Number(query.value) } : { search: query.value, per_page: 20 });
        results.value = data;
        SHOW_RESULTS.value = true;
    } catch (e: any) {
        showError(e?.response?.data?.message || 'No se pudo buscar');
    } finally {
        loading.value = false;
    }
}

/** Simple debounce wrapper for text input to limit server calls while typing. */
function debouncedSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(doSearch, 250);
}

/**
 * Global key listener that captures digits emitted by USB barcode scanners.
 * It collects digits until Enter is pressed, then dispatches a find-by-barcode.
 */
function handleKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    if (!scanActive.value && /^\d$/.test(e.key)) {
        scanActive.value = true;
        scanBuffer.value = e.key;
        scanTimer = window.setTimeout(resetScan, 500);
        e.preventDefault();
        return;
    }

    if (scanActive.value) {
        if (e.key === 'Enter') {
            const code = scanBuffer.value;
            resetScan();
            query.value = code;
            addFirstMatchFromBarcode(code);
            e.preventDefault();
            return;
        }
        if (/^\d$/.test(e.key)) {
            scanBuffer.value += e.key;
            if (scanTimer) {
                clearTimeout(scanTimer);
                scanTimer = window.setTimeout(resetScan, 500);
            }
            e.preventDefault();
            return;
        }
    }
}

/** Resets any ongoing scan capture when the input stream is interrupted. */
function resetScan() {
    scanActive.value = false;
   scanBuffer.value = '';
   if (scanTimer) clearTimeout(scanTimer);
}

/** Finds the first product that matches a scanned barcode and sends it to the cart. */
async function addFirstMatchFromBarcode(code: string) {
    try {
        const rows = await findProduct({ barcode: Number(code) });
        if (rows?.length) addToCart(rows[0]);
    } catch {
        /* silent */
    }
}

/** Inserts or updates a cart row and reapplies promotions on every addition. */
async function addToCart(producto: Producto) {
    SHOW_RESULTS.value = false;
    query.value = '';

    const row = cart.value.find(r => r.ident === producto.ident);
    const max = Number(producto?.inventario?.existencia ?? 0);

    if (row) {
        if (row.qty < max) row.qty++;
        await applyPromotionsToRow(row, producto.proveedorid);
        return;
    }

    const newRow: CartRow = {
        ident: producto.ident,
        nombre: producto.nombre,
        precio: Number(producto.precio),
        proveedorname: producto.proveedor?.nombre,
        existencia: max,
        qty: max > 0 ? 1 : 0,
        proveedorid: producto.proveedorid,
    };

    await applyPromotionsToRow(newRow, producto.proveedorid);
    cart.value.unshift(newRow);
}

/** Keeps quantities valid while reacting to manual edits on the cart table. */
async function onQtyChange(row: CartRow) {
    clampQty(row);
    await applyPromotionsToRow(row, row.proveedorid);
}

/** Removes an item entirely from the cart. */
function removeFromCart(ident: number) {
    cart.value = cart.value.filter(row => row.ident !== ident);
}

/** Ensures quantity stays within 0..existence and always an integer. */
function clampQty(row: CartRow) {
    row.qty = Math.trunc(Number(row.qty) || 0);
    if (row.qty < 0) row.qty = 0;
    if (row.qty > row.existencia) row.qty = row.existencia;
}

/** Refreshes the caja status banner (open/closed, current user, balances). */
async function refreshCaja() {
    const data = await cajaStatus();
    caja.value = data ?? { open: false, caja: null };
}

/** Opens the cash drawer with an initial balance. */
async function openCaja() {
    resetAlerts();
    if (openAmount.value == null || openAmount.value < 0) {
        showError('Saldo inicial inválido');
        return;
    }
    saving.value = true;
    try {
        await cajaOpen({ saldoinicial: Number(openAmount.value) });
        clearError();
        showMessage('Caja abierta');
        await refreshCaja();
    } catch (e: any) {
        showError(e?.response?.data?.message || 'No se pudo abrir caja');
    } finally {
        saving.value = false;
    }
}

/** Closes the cash drawer sending the optional counted final balance. */
async function closeCaja() {
    resetAlerts();
    saving.value = true;
    try {
        const payload = closeAmount.value != null ? { saldofinal: Number(closeAmount.value) } : undefined;
        await cajaClose(payload);
        clearError();
        showMessage('Caja cerrada');
        await refreshCaja();
    } catch (e: any) {
        showError(e?.response?.data?.message || 'No se pudo cerrar caja');
    } finally {
        saving.value = false;
    }
}

/** Opens the modal with a clean state ready to capture a new expense. */
function openExpenseModal() {
    expenseError.value = '';
    resetExpenseForm();
    showExpenseModal.value = true;
}

/** Closes the expense modal unless a request is pending. */
function closeExpenseModal() {
    if (expenseSaving.value) return;
    showExpenseModal.value = false;
}

/** Persists a manual expense (egreso) tied to the current caja session. */
async function submitExpense() {
    expenseError.value = '';
    if (!caja.value.open) {
        expenseError.value = 'Abre caja antes de registrar un egreso';
        return;
    }
    if (!expenseForm.total || expenseForm.total <= 0) {
        expenseError.value = 'Monto inválido';
        return;
    }
    if (!expenseForm.concepto.trim()) {
        expenseError.value = 'Concepto requerido';
        return;
    }

    const fecha = formatToDMY(expenseForm.fecha);
    const payload: CashMovementPayload = {
        totalventa: Number(expenseForm.total),
        metodo: 'efectivo',
        recibo: 0,
        cambio: 0,
        vendedor: caja.value?.caja?.usuario ?? 'Manual',
        fecha,
        ie: 0,
        concepto: expenseForm.concepto.trim(),
    };

    expenseSaving.value = true;
    try {
        await registerExpense(payload);
        clearError();
        showMessage('Egreso registrado');
        showExpenseModal.value = false;
        resetExpenseForm();
        await refreshCaja();
    } catch (e: any) {
        expenseError.value = e?.response?.data?.message || 'No se pudo registrar el egreso';
        showError(expenseError.value);
    } finally {
        expenseSaving.value = false;
    }
}

/** Sends the sale to the backend and resets local cart state upon success. */
async function onCheckout() {
    resetAlerts();
    if (!caja.value.open) {
        showError('Abre caja antes de vender');
        return;
    }

    const items = cart.value.filter(row => row.qty > 0).map(row => ({ ident: row.ident, qty: row.qty }));
    if (!items.length) {
        showError('Carrito vacío');
        return;
    }

    if (paymentMethod.value === 'efectivo') {
        const received = Number(cashReceived.value ?? 0);
        if (received < total.value) {
            showError('Efectivo recibido insuficiente');
            return;
        }
    }

    saving.value = true;
    try {
        const payload = {
            items,
            discount_percent: effectiveDiscountPercentForBE.value,
            payment: {
                method: paymentMethod.value,
                ...(paymentMethod.value === 'efectivo' ? { received: Number(cashReceived.value ?? 0) } : {})
            },
            ie: 1
        };

        const res = await checkout(payload);
        const ventaId = res?.data?.venta?.idventa;
        const snapshot = captureSaleSnapshot(ventaId ?? Date.now());
        openTicketModal(snapshot);
        clearError();
        showMessage('Venta realizada con promociones aplicadas');

        cart.value = [];
        discountPercent.value = 0;
        cashReceived.value = null;
        await refreshCaja();
    } catch (e: any) {
        showError(e?.response?.data?.message || 'No se pudo terminar la venta');
    } finally {
        saving.value = false;
    }
}

function buildReceiptPDF(snapshot: SaleSnapshot) {
    const rows = snapshot.rows;
    const fecha = snapshot.fecha;

    const money = (amount: number, currencyCode = 'MXN', locale = 'es-MX') => {
        try { return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, minimumFractionDigits: 2 }).format(amount); }
        catch { return `$${amount.toFixed(2)}`; }
    };

    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const PAGE_W = 215.9;
    const PAGE_H = 279.4;
    const MARGIN = 12;
    const INNER_W = PAGE_W - MARGIN * 2;
    const xL = MARGIN;
    const xMidRight = PAGE_W - MARGIN;
    const lineGap = 6;
    let y = 45;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Ticket de venta', 15, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Ticket #${snapshot.idventa}`, 15, 27);
    doc.text(`Fecha: ${fecha}`, 15, 33);
    if (caja.value?.caja?.usuario) {
        doc.text(`Vendedor: ${caja.value.caja.usuario}`, 15, 39);
    }

    const hr = () => { doc.setDrawColor(220); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 2; };
    const rowR = (label: string, value: string, bold = false) => {
        pageBreakIfNeeded();
        if (bold) doc.setFont('helvetica', 'bold');
        doc.text(label, xL, y);
        doc.text(value, xMidRight, y, { align: 'right' });
        if (bold) doc.setFont('helvetica', 'normal');
        y += lineGap;
    };

    hr();
    doc.setFont('helvetica', 'bold');
    doc.text('Productos', xL, y); y += lineGap;
    doc.setFont('helvetica', 'normal');

    rows.forEach(row => {
        const nameLines = doc.splitTextToSize(row.nombre || 'Producto', INNER_W);
        nameLines.forEach((ln: string) => {
            pageBreakIfNeeded();
            doc.text(ln, xL, y);
            y += lineGap;
        });

        if (row.proveedorname) {
            pageBreakIfNeeded();
            doc.setFontSize(9);
            doc.setTextColor(120, 120, 120);
            doc.text(`Proveedor: ${row.proveedorname}`, xL, y);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            y += lineGap - 2;
        }

        if (row.promoNote) {
            pageBreakIfNeeded();
            doc.setFontSize(9);
            doc.setTextColor(0, 128, 96);
            doc.text(`• ${row.promoNote}`, xL, y);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            y += lineGap - 2;
        }

        const lineDiscount = linePromoDiscount(row);
        const gross = row.precio * row.qty;
        const net = Math.max(0, gross - lineDiscount);

        pageBreakIfNeeded();
        doc.text(`${row.qty} × ${money(row.precio)}`, xL, y);
        doc.text(money(net), xMidRight, y, { align: 'right' }); y += lineGap;

        if (lineDiscount > 0) {
            pageBreakIfNeeded();
            doc.setFontSize(9);
            doc.text('Descuento aplicado', xL, y);
            doc.text(`- ${money(lineDiscount)}`, xMidRight, y, { align: 'right' });
            doc.setFontSize(10);
            y += lineGap - 2;
        }

        y += 2;
    });

    hr();
    rowR('Subtotal', money(snapshot.subtotal));
    if (snapshot.promoDiscount) rowR('Promociones', `- ${money(snapshot.promoDiscount)}`);
    if (snapshot.manualDiscount) rowR('Desc. manual', `- ${money(snapshot.manualDiscount)}`);
    if (snapshot.surchargeAmount) rowR(`Recargo ${snapshot.surchargePercent}%`, money(snapshot.surchargeAmount));
    rowR('TOTAL', money(snapshot.total), true);

    hr();
    rowR('Método', snapshot.paymentMethod.toUpperCase());
    rowR('Recibido', money(snapshot.cashReceived));
    rowR('Cambio', money(snapshot.change));

    y += 2; pageBreakIfNeeded();
    doc.setFontSize(9);
    doc.text('¡Gracias por su compra!', PAGE_W / 2, y, { align: 'center' });

    function pageBreakIfNeeded() {
        if (y > (PAGE_H - MARGIN - lineGap)) {
            doc.addPage('letter', 'portrait');
            y = MARGIN;
        }
    }

    return doc;
}

/** Builds and downloads the thermal ticket PDF summarizing the recent sale. */
async function makeReceiptPDFFromSale(snapshot: SaleSnapshot) {
    const doc = buildReceiptPDF(snapshot);
    doc.save(`ticket_${snapshot.idventa}.pdf`);
}

// Lifecycle hooks ------------------------------------------------
/** Prime caja state and start listening for scanner input when view mounts. */
onMounted(async () => {
    await refreshCaja();
    window.addEventListener('keydown', handleKeydown);
});

/** Tear down timers and listeners to keep things tidy on navigation. */
onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer);
    if (scanTimer) clearTimeout(scanTimer);
    if (messageTimer) clearTimeout(messageTimer);
    if (errorTimer) clearTimeout(errorTimer);
    if (clientSearchTimer) clearTimeout(clientSearchTimer);
    window.removeEventListener('keydown', handleKeydown);
});
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

            <section class="space-y-3 text-[13px] leading-tight">
                <!-- Search -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Buscar / Escanear</label>
                    <input v-model="query" @input="debouncedSearch" type="text" placeholder="Nombre, ident, proveedor…"
                        class="w-full rounded-md border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-2.5 py-1.5 text-[13px]" />
                    <p class="text-[11px] text-gray-500 mt-1">
                        Escáner USB: apunte al input o presione Enter al final del código.
                    </p>
                </div>

                <!-- Results (compact) -->
                <div v-if="SHOW_RESULTS" class="border rounded-md max-h-56 overflow-auto">
                    <table class="min-w-full text-xs">
                        <thead class="bg-gray-50 text-gray-500 sticky top-0 z-10">
                            <tr>
                                <th class="text-left font-medium px-2.5 py-1.5">Ident</th>
                                <th class="text-left font-medium px-2.5 py-1.5">Producto</th>
                                <th class="text-right font-medium px-2.5 py-1.5">Precio</th>
                                <th class="text-right font-medium px-2.5 py-1.5">Exist.</th>
                                <th class="px-2.5 py-1.5"></th>
                            </tr>
                        </thead>
                        <tbody class="[&>tr:nth-child(even)]:bg-gray-50/60">
                            <tr v-for="p in results" :key="p.id" class="hover:bg-gray-50">
                                <td class="px-2.5 py-1.5 whitespace-nowrap">{{ p.ident }}</td>
                                <td class="px-2.5 py-1.5">
                                    <div class="truncate max-w-[28ch]">{{ p.nombre }}</div>
                                </td>
                                <td class="px-2.5 py-1.5 text-right whitespace-nowrap">
                                    {{ new
                                        Intl.NumberFormat('es-MX', { style: 'currency',currency:'MXN'}).format(Number(p.precio))
                                    }}
                                </td>
                                <td class="px-2.5 py-1.5 text-right whitespace-nowrap">
                                    {{ Number(p?.inventario?.existencia ?? 0) }}
                                </td>
                                <td class="px-2.5 py-1.5 text-right">
                                    <button @click="addToCart(p)"
                                        class="rounded border px-2 py-1 text-[12px] hover:bg-gray-100">
                                        Agregar
                                    </button>
                                </td>
                            </tr>
                            <tr v-if="!loading && results.length === 0">
                                <td colspan="5" class="px-2.5 py-2.5 text-center text-gray-500">Sin resultados</td>
                            </tr>
                            <tr v-if="loading">
                                <td colspan="5" class="px-2.5 py-2.5 text-center text-gray-500">Buscando…</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
                <!-- Cart -->
                <section class="flex-1 space-y-3 text-[13px] leading-tight">
                    <div class="border rounded-md overflow-hidden">
                        <div class="px-3 py-2 border-b text-xs font-semibold tracking-wide text-gray-700">Carrito</div>
                        <div class="overflow-x-auto">
                            <table class="min-w-full text-xs">
                                <thead class="bg-gray-50 text-gray-500 sticky top-0 z-10">
                                    <tr>
                                        <th class="text-left font-medium px-2.5 py-1.5">Ident</th>
                                        <th class="text-left font-medium px-2.5 py-1.5">Producto</th>
                                        <th class="text-left font-medium px-2.5 py-1.5">Proveedor</th>
                                        <th class="text-right font-medium px-2.5 py-1.5">P. Unit.</th>
                                        <th class="text-right font-medium px-2.5 py-1.5">Exist.</th>
                                        <th class="text-right font-medium px-2.5 py-1.5">Cantidad</th>
                                        <th class="text-right font-medium px-2.5 py-1.5">Importe</th>
                                        <th class="px-2.5 py-1.5"></th>
                                    </tr>
                                </thead>
                                <tbody class="[&>tr:nth-child(even)]:bg-gray-50/60">
                                    <tr v-for="r in cart" :key="r.ident" class="align-middle">
                                        <td class="px-2.5 py-1.5 whitespace-nowrap">{{ r.ident }}</td>
                                        <td class="px-2.5 py-1.5">
                                            <div class="truncate max-w-[28ch]">{{ r.nombre }}</div>
                                            <div v-if="r.promoNote" class="text-[11px] text-emerald-700">
                                                {{ r.promoNote }}
                                            </div>
                                        </td>
                                        <td class="px-2.5 py-1.5 text-right">
                                            <span class="truncate inline-block max-w-[18ch]">{{ r.proveedorname }}</span>
                                        </td>
                                        <td class="px-2.5 py-1.5 text-right whitespace-nowrap">{{ currency(r.precio) }}</td>
                                        <td class="px-2.5 py-1.5 text-right">{{ r.existencia }}</td>
                                        <td class="px-2.5 py-1.5 text-right">
                                            <input v-model.number="r.qty" @change="onQtyChange(r)" type="number" min="0"
                                                :max="r.existencia"
                                                class="w-20 rounded border px-2 py-1 text-right text-[12px]" />
                                            <div v-if="(r.promoFreeQty ?? 0) > 0" class="text-[11px] text-gray-500">
                                                Cobrar: {{ Math.max(0, r.qty - (r.promoFreeQty ?? 0)) }}
                                            </div>
                                        </td>
                                        <td class="px-2.5 py-1.5 text-right whitespace-nowrap">
                                            {{
                                                new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
                                                    .format(r.precio * Math.max(0, r.qty - (r.promoFreeQty ?? 0)) * (1 -
                                            (r.promoDiscountPct ?? 0)/100))
                                            }}
                                        </td>
                                        <td class="px-2.5 py-1.5 text-right">
                                            <button @click="removeFromCart(r.ident)"
                                                class="rounded border px-2 py-1 text-[12px] hover:bg-gray-100">
                                                Quitar
                                            </button>
                                        </td>
                                    </tr>
                                    <tr v-if="cart.length === 0">
                                        <td colspan="8" class="px-2.5 py-4 text-center text-gray-500">No hay productos en
                                            el carrito</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <!-- Totals & Payment -->
                <section class="space-y-3 text-[13px] leading-tight lg:w-80 lg:shrink-0">
                    <div class="border rounded-md p-3 space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Descuento (%)</label>
                            <input v-model.number="discountPercent" type="number" step="0.5" min="0" max="100"
                                class="w-full rounded-md border px-2.5 py-1.5 text-[13px]" />
                        </div>

                        <div class="text-[13px] space-y-1">
                            <div class="flex justify-between"><span>Subtotal</span><b>{{ currency(subTotal) }}</b></div>
                            <div class="flex justify-between" v-if="promoDiscountAmount">
                                <span>Promociones</span>
                                <b class="text-emerald-700">- {{ currency(promoDiscountAmount) }}</b>
                            </div>
                            <div class="flex justify-between">
                                <span>Descuento manual</span><b>- {{ currency(discountAmount) }}</b>
                            </div>
                            <div class="flex justify-between">
                                <span>Recargo {{ surchargePercent ? `(${surchargePercent}%)` : '' }}</span>
                                <b>{{ currency(surchargeAmount) }}</b>
                            </div>
                            <div class="flex justify-between text-base">
                                <span>Total</span><b>{{ currency(total) }}</b>
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Método de pago</label>
                            <div class="flex gap-2">
                                <button @click="paymentMethod = 'efectivo'"
                                    :class="['px-2.5 py-1.5 rounded border text-xs', paymentMethod === 'efectivo' ? 'bg-gray-900 text-white' : '']">Efectivo</button>
                                <button @click="paymentMethod = 'debit'"
                                    :class="['px-2.5 py-1.5 rounded border text-xs', paymentMethod === 'debit' ? 'bg-gray-900 text-white' : '']">Débito</button>
                                <button @click="paymentMethod = 'credit'"
                                    :class="['px-2.5 py-1.5 rounded border text-xs', paymentMethod === 'credit' ? 'bg-gray-900 text-white' : '']">Crédito</button>
                            </div>
                        </div>

                        <div v-if="paymentMethod === 'efectivo'">
                            <label class="block text-xs font-medium text-gray-600 mb-1">Efectivo recibido</label>
                            <input v-model.number="cashReceived" type="number" step="0.01" min="0"
                                class="w-full rounded-md border px-2.5 py-1.5 text-[13px]" />
                            <div class="mt-2 text-[13px] text-gray-700 flex justify-between">
                                <span>Cambio</span><b>{{ currency(changeDue) }}</b>
                            </div>
                        </div>

                        <div class="space-y-2">
                            <button :disabled="saving || !caja.open || cart.length === 0" @click="onCheckout"
                                class="w-full rounded-md bg-[#E4007C] hover:bg-[#cc006f] text-white px-3 py-2 text-[13px] disabled:opacity-60">
                                Cobrar
                            </button>
                            <button type="button" @click="openExpenseModal"
                                class="w-full rounded-md border border-gray-300 px-3 py-2 text-[13px] hover:bg-gray-50">
                                Registrar egreso
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    <div v-if="showExpenseModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        @click.self="closeExpenseModal">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h2 class="text-lg font-semibold text-gray-900">Registrar egreso</h2>
                <p class="mt-1 text-sm text-gray-500">Captura salidas de efectivo para mantener el control de caja.</p>

                <div v-if="expenseError" class="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {{ expenseError }}
                </div>

                <div class="mt-4 space-y-3 text-[13px] leading-tight">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Concepto</label>
                        <input v-model="expenseForm.concepto" type="text" placeholder="Descripción del egreso"
                            class="w-full rounded-md border px-2.5 py-1.5 text-[13px]" />
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Monto</label>
                        <input v-model.number="expenseForm.total" type="number" min="0" step="0.01"
                            class="w-full rounded-md border px-2.5 py-1.5 text-[13px]" />
                    </div>
                    <p class="text-xs text-gray-500">El egreso se registrará como <b>efectivo</b>.</p>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Fecha</label>
                        <input v-model="expenseForm.fecha" type="date"
                            class="w-full rounded-md border px-2.5 py-1.5 text-[13px]" />
                    </div>
                </div>

                <div class="mt-5 flex justify-end gap-2">
                    <button type="button" @click="closeExpenseModal" :disabled="expenseSaving"
                        class="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60">
                        Cancelar
                    </button>
                    <button type="button" @click="submitExpense" :disabled="expenseSaving"
                        class="rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-60">
                        {{ expenseSaving ? 'Guardando…' : 'Guardar egreso' }}
                    </button>
                </div>
            </div>
        </div>
        <div v-if="showTicketModal && lastSaleSnapshot" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            @click.self="closeTicketModal">
            <div class="w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h2 class="text-lg font-semibold text-gray-900">Ticket de venta #{{ lastSaleSnapshot?.idventa }}</h2>
                        <p class="text-xs text-gray-500 mt-1">Elige cómo entregar el comprobante al cliente. Total: <span class="font-semibold text-gray-800">{{ currency(lastSaleSnapshot?.total ?? 0) }}</span></p>
                    </div>
                    <button type="button" @click="closeTicketModal"
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">✕</button>
                </div>

                <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button type="button" @click="onPrintTicket"
                            class="rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 text-sm disabled:opacity-60">
                            Imprimir ticket
                        </button>
                        <div class="flex flex-wrap items-center gap-2">
                            <label class="text-sm text-gray-600">Enviar por</label>
                            <select v-model="ticketSendChannel"
                                class="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:ring-gray-900">
                                <option value="email">Email</option>
                                <option value="sms" disabled>SMS (próximamente)</option>
                            </select>
                            <button type="button" @click="sendTicket" :disabled="ticketSending"
                                class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
                                {{ ticketSending ? 'Enviando…' : 'Enviar ticket' }}
                            </button>
                        </div>
                    </div>
                    <p class="text-xs text-gray-500">Para enviar el ticket completa los datos del cliente o selecciona uno existente.</p>
                </div>

                <div class="space-y-3">
                    <div class="space-y-1">
                        <label class="block text-sm font-medium text-gray-700">Buscar cliente</label>
                        <input v-model="clientSearch" type="text" placeholder="Nombre o correo…"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                        <div v-if="clientSearchLoading" class="text-xs text-gray-500">Buscando…</div>
                        <ul v-else-if="clientSuggestions.length"
                            class="max-h-40 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
                            <li v-for="c in clientSuggestions" :key="c.id"
                                class="px-3 py-2 cursor-pointer hover:bg-gray-50"
                                @click="selectClientSuggestion(c)">
                                <div class="font-medium text-gray-800">{{ c.nombre }}</div>
                                <div class="text-xs text-gray-500">{{ c.email || 'Sin email' }} · {{ c.telefono || 'Sin teléfono' }}</div>
                            </li>
                        </ul>
                        <div v-else-if="clientSearchNoResults" class="text-xs text-gray-500">Sin resultados</div>
                    </div>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Nombre</label>
                            <input v-model="clientForm.nombre" type="text"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="Nombre del cliente" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Correo electrónico</label>
                            <input v-model="clientForm.email" type="email"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="cliente@email.com" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Teléfono</label>
                            <input v-model="clientForm.telefono" type="tel"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="10 dígitos" />
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <button type="button" @click="saveCliente" :disabled="clientSaving"
                            class="rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 text-sm disabled:opacity-60">
                            Guardar cliente
                        </button>
                        <button type="button" @click="resetClientForm"
                            class="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                            Limpiar
                        </button>
                    </div>

                    <div v-if="clientMessage" class="rounded border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">{{ clientMessage }}</div>
                    <div v-if="clientError" class="rounded border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">{{ clientError }}</div>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
