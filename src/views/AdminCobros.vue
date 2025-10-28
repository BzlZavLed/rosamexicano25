<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { jsPDF } from 'jspdf';
import AppLayout from '../components/layout/AppLayout.vue';
import { listProveedoresAll, type Proveedor } from '../api/proveedores';
import { createCobro, createCobrosBatch, listMensualidad, payMensualidad, type Mensualidad } from '../api/cobros';

const loadingProveedores = ref(true);
const proveedoresError = ref('');
const proveedores = ref<Proveedor[]>([]);

const bulkForm = reactive({
    mes_cobro: currentMonth(),
    fecha_cobro: todayISO(),
    concepto: defaultBulkConcept(currentMonth()),
    nota: '',
});

const bulkState = reactive({
    running: false,
    successCount: 0,
});

const bulkMessage = ref('');
const bulkError = ref('');
const bulkFailures = ref<Array<{ proveedor: Proveedor; error: string }>>([]);

const singleForm = reactive({
    proveedor_id: null as number | null,
    concepto: 'Cobro de mensualidad',
    importe: null as number | null,
    fecha_cobro: todayISO(),
    mes_cobro: currentMonth(),
    nota: '',
});

const singleMessage = ref('');
const singleError = ref('');
const singleSaving = ref(false);

const cobrosLoading = ref(false);
const cobrosError = ref('');
const cobros = ref<Mensualidad[]>([]);
const cobrosMeta = reactive({
    page: 1,
    perPage: 10,
    total: 0,
    lastPage: 1,
});
const cobrosSearch = ref('');
const cobrosMes = ref('');
const cobrosStatus = ref('');
let cobrosFilterTimer: number | undefined;

const paymentModalOpen = ref(false);
const paymentSaving = ref(false);
const paymentError = ref('');
const paymentMessage = ref('');
const paymentTarget = ref<Mensualidad | null>(null);
const paymentForm = reactive({
    mensualidadId: null as number | null,
    proveedorId: null as number | null,
    concepto: '',
    importe: 0,
    cantidad_pago: null as number | null,
    restante: null as number | null,
    payment_date: todayISO(),
    subject: '',
    message: '',
});

const proveedoresOrdenados = computed(() =>
    [...proveedores.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
);

const proveedoresConImporte = computed(() =>
    proveedoresOrdenados.value.filter((p) => Number(p.importe ?? 0) > 0)
);

const proveedoresSinImporte = computed(() =>
    proveedoresOrdenados.value.filter((p) => Number(p.importe ?? 0) <= 0)
);

const totalMensual = computed(() =>
    Math.round(
        proveedoresConImporte.value.reduce((sum, p) => sum + Number(p.importe ?? 0), 0) * 100
    ) / 100
);

const canRunBulk = computed(
    () =>
        !bulkState.running &&
        proveedoresConImporte.value.length > 0 &&
        Boolean(
            bulkForm.mes_cobro &&
            bulkForm.fecha_cobro &&
            bulkForm.concepto &&
            bulkForm.concepto.trim()
        )
);

const proveedorSeleccionado = computed(
    () => proveedores.value.find((p) => p.id === singleForm.proveedor_id) || null
);

watch(
    () => singleForm.proveedor_id,
    (newId) => {
        if (!newId) return;
        const proveedor = proveedores.value.find((p) => p.id === newId);
        if (proveedor && typeof proveedor.importe === 'number' && proveedor.importe > 0) {
            singleForm.importe = Math.round(Number(proveedor.importe) * 100) / 100;
        }
    }
);

watch(
    () => bulkForm.mes_cobro,
    (newVal, oldVal) => {
        if (!newVal) return;
        const newDefault = defaultBulkConcept(newVal);
        if (
            !bulkForm.concepto ||
            (oldVal && bulkForm.concepto === defaultBulkConcept(oldVal))
        ) {
            bulkForm.concepto = newDefault;
        }
    }
);

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(amount: number, currencyCode = 'MXN', locale = 'es-MX') {
    if (!Number.isFinite(amount)) return '$0.00';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(amount);
    } catch {
        return `$${amount.toFixed(2)}`;
    }
}

function formatMonthLabel(value: string) {
    if (!value) return '';
    const [year, month] = value.split('-').map((x) => Number(x));
    if (!year || !month) return value;
    const formatter = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
    return formatter.format(new Date(year, month - 1, 1));
}

function defaultBulkConcept(value: string) {
    const label = formatMonthLabel(value);
    return label ? `Cobro mensualidad ${label}` : 'Cobro mensualidad';
}

function formatDateLabel(value: string) {
    if (!value) return '';
    const [year, month, day] = value.split('-').map((x) => Number(x));
    if (!year || !month || !day) return value;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function slugify(value: string) {
    return (
        value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'proveedor'
    );
}

function parseErrorMessage(err: any) {
    return err?.response?.data?.message || err?.message || 'Ocurrió un error inesperado';
}

function resetPaymentForm() {
    paymentForm.mensualidadId = null;
    paymentForm.proveedorId = null;
    paymentForm.concepto = '';
    paymentForm.importe = 0;
    paymentForm.cantidad_pago = null;
    paymentForm.restante = null;
    paymentForm.payment_date = todayISO();
    paymentForm.subject = '';
    paymentForm.message = '';
    paymentError.value = '';
    paymentMessage.value = '';
    paymentTarget.value = null;
}

function openPaymentModal(m: Mensualidad) {
    resetPaymentForm();
    paymentTarget.value = m;
    paymentForm.mensualidadId = m.id;
    paymentForm.proveedorId = m.proveedor_id ?? null;
    paymentForm.concepto = m.concepto;
    paymentForm.importe = Number(m.importe ?? 0);
    const pendiente = m.restante ?? (m.importe ?? 0) - (m.pagado ?? 0);
    const cleanPendiente = Math.max(0, Math.round(Number(pendiente) * 100) / 100);
    paymentForm.cantidad_pago = cleanPendiente > 0 ? cleanPendiente : Number(m.importe ?? 0);
    paymentForm.restante = cleanPendiente > 0 ? cleanPendiente : 0;
    paymentForm.subject = `Pago ${m.concepto}`;
    paymentForm.message = '';
    paymentModalOpen.value = true;
}

function closePaymentModal() {
    paymentModalOpen.value = false;
    if (typeof window !== 'undefined') {
        window.setTimeout(resetPaymentForm, 200);
    } else {
        resetPaymentForm();
    }
}

function updateRestante() {
    const importe = Number(paymentForm.importe ?? 0);
    const pagado = Number(paymentForm.cantidad_pago ?? 0);
    if (!Number.isFinite(importe) || !Number.isFinite(pagado)) {
        paymentForm.restante = null;
        return;
    }
    const restante = Math.max(0, Math.round((importe - pagado) * 100) / 100);
    paymentForm.restante = restante;
}

async function submitPayment() {
    paymentError.value = '';
    paymentMessage.value = '';

    if (!paymentForm.mensualidadId) {
        paymentError.value = 'No se seleccionó el cobro.';
        return;
    }
    const cantidad = Number(paymentForm.cantidad_pago ?? 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
        paymentError.value = 'Indica la cantidad pagada.';
        return;
    }

    const target = paymentTarget.value;
    if (!target) {
        paymentError.value = 'No se pudo determinar el cobro seleccionado.';
        return;
    }

    paymentSaving.value = true;
    try {
        const restante = paymentForm.restante ?? Math.max(0, Math.round((paymentForm.importe - cantidad) * 100) / 100);
        paymentForm.restante = restante;
        const paymentDate = paymentForm.payment_date || todayISO();

        const receipt = generatePagoPdf(target, {
            concepto: paymentForm.concepto,
            importe: paymentForm.importe,
            cantidadPago: cantidad,
            restante,
            paymentDate,
            subject: paymentForm.subject?.trim() || null,
            message: paymentForm.message?.trim() || null,
        });

        await payMensualidad(paymentForm.mensualidadId, {
            provider_id: paymentForm.proveedorId ?? undefined,
            receipt_pdf_base64: receipt.base64,
            cantidad_pago: cantidad,
            restante,
            payment_date: paymentDate || undefined,
            subject: paymentForm.subject?.trim() || undefined,
            message: paymentForm.message?.trim() || undefined,
        });
        paymentMessage.value = 'Pago registrado correctamente.';
        openPdfInNewTab(receipt.base64);
        await loadCobros();
        if (typeof window !== 'undefined') {
            window.setTimeout(() => {
                closePaymentModal();
            }, 600);
        } else {
            closePaymentModal();
        }
    } catch (err: any) {
        paymentError.value = parseErrorMessage(err);
    } finally {
        paymentSaving.value = false;
    }
}

function formatStatus(status?: string | null) {
    if (!status) return 'Pendiente';
    const normalized = status.toLowerCase();
    if (normalized === 'paid') return 'Pagado';
    if (normalized === 'pending') return 'Pendiente';
    if (normalized === 'failed') return 'Rechazado';
    return status;
}

function statusBadgeClass(status?: string | null) {
    if (!status) return 'bg-amber-100 text-amber-700 border-amber-200';
    const normalized = status.toLowerCase();
    if (normalized === 'paid') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (normalized === 'failed') return 'bg-rose-100 text-rose-700 border-rose-200';
    return 'bg-amber-100 text-amber-700 border-amber-200';
}

type PdfContext = {
    concepto: string;
    importe: number;
    fecha_cobro: string;
    mes_cobro: string;
    nota?: string | null;
};

function generateCobroPdf(proveedor: Proveedor, ctx: PdfContext) {
    const doc = new jsPDF();
    const marginX = 18;
    let y = 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Rosa Mexicano', marginX, y);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    y += 10;
    doc.text(`Fecha de emisión: ${formatDateLabel(ctx.fecha_cobro)}`, marginX, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Nota de cobro', marginX, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.text(`Proveedor: ${proveedor.nombre}`, marginX, y);
    y += 6;
    doc.text(`Identificador interno: ${proveedor.ident}`, marginX, y);
    y += 6;
    if (proveedor.email) {
        doc.text(`Correo de contacto: ${proveedor.email}`, marginX, y);
        y += 6;
    }
    if (proveedor.tel) {
        doc.text(`Teléfono: ${proveedor.tel}`, marginX, y);
        y += 6;
    }
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.text('Detalle del cobro', marginX, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.text(`Concepto: ${ctx.concepto}`, marginX, y);
    y += 6;
    doc.text(`Mes aplicado: ${formatMonthLabel(ctx.mes_cobro)}`, marginX, y);
    y += 6;
    doc.text(`Fecha de cargo: ${formatDateLabel(ctx.fecha_cobro)}`, marginX, y);
    y += 6;
    doc.text(`Monto: ${formatCurrency(ctx.importe)}`, marginX, y);
    y += 8;

    if (ctx.nota && ctx.nota.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.text('Notas adicionales', marginX, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(ctx.nota.trim(), 170);
        doc.text(lines, marginX, y);
        y += lines.length * 6;
    }

    y += 10;
    doc.setFont('helvetica', 'italic');
    doc.text('Gracias por ser parte de Rosa Mexicano.', marginX, y);

    const dataUri = doc.output('datauristring');
    const pdfBase64 = (dataUri.split(',')[1] ?? '').trim();
    const safeName = slugify(proveedor.nombre || `proveedor-${proveedor.id}`);
    const filename = `cobro-${ctx.mes_cobro}-${safeName}.pdf`;

    return { base64: pdfBase64, filename };
}

type PagoPdfContext = {
    concepto: string;
    importe: number;
    cantidadPago: number;
    restante: number;
    paymentDate: string;
    subject?: string | null;
    message?: string | null;
};

function generatePagoPdf(mensualidad: Mensualidad, ctx: PagoPdfContext) {
    const doc = new jsPDF();
    const marginX = 18;
    let y = 20;

    const providerName = mensualidad.proveedor_nombre ?? `Proveedor #${mensualidad.proveedor_id}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Recibo de pago', marginX, y);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    y += 8;
    doc.text(`Proveedor: ${providerName}`, marginX, y);
    y += 6;
    doc.text(`Identificador interno: ${mensualidad.proveedor_ident ?? mensualidad.proveedor_id}`, marginX, y);
    y += 6;
    doc.text(`Concepto: ${ctx.concepto}`, marginX, y);
    y += 6;
    doc.text(`Mes asociado: ${formatMonthLabel(mensualidad.mes_cobro)}`, marginX, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Detalle del pago', marginX, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha de pago: ${formatDateLabel(ctx.paymentDate)}`, marginX, y);
    y += 6;
    doc.text(`Importe original: ${formatCurrency(Number(ctx.importe ?? 0))}`, marginX, y);
    y += 6;
    doc.text(`Cantidad pagada: ${formatCurrency(Number(ctx.cantidadPago ?? 0))}`, marginX, y);
    y += 6;
    doc.text(`Saldo restante: ${formatCurrency(Number(ctx.restante ?? 0))}`, marginX, y);
    y += 8;

    if (ctx.subject) {
        doc.setFont('helvetica', 'bold');
        doc.text(`Asunto: ${ctx.subject}`, marginX, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
    }

    if (ctx.message) {
        doc.setFont('helvetica', 'bold');
        doc.text('Mensaje:', marginX, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(ctx.message, 170);
        doc.text(lines, marginX, y);
        y += lines.length * 6;
    }

    y += 10;
    doc.setFont('helvetica', 'italic');
    doc.text('Gracias por tu pago.', marginX, y);

    const dataUri = doc.output('datauristring');
    const pdfBase64 = (dataUri.split(',')[1] ?? '').trim();
    const safeName = slugify(providerName);
    const filename = `pago-${ctx.paymentDate}-${safeName}.pdf`;

    return { base64: pdfBase64, filename };
}

function openPdfInNewTab(resource: string) {
    if (!resource || typeof window === 'undefined') return;

    const isHttp = resource.startsWith('http://') || resource.startsWith('https://');
    const isDataUri = resource.startsWith('data:');
    const isPath = resource.startsWith('/') || resource.startsWith('./') || resource.startsWith('../');
    const maybeBase64 = !isHttp && !isDataUri ? resource.trim() : '';

    if (isHttp || isDataUri || isPath) {
        const win = window.open(resource, '_blank', 'noopener,noreferrer');
        if (!win) console.warn('El navegador bloqueó la apertura del PDF.');
        return;
    }

    let url: string | null = null;
    let revoke: (() => void) | undefined;

    try {
        const binary = atob(maybeBase64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
        revoke = () => URL.revokeObjectURL(url!);
    } catch (err) {
        console.warn('No se pudo crear Blob para el PDF, usando data URI', err);
        url = `data:application/pdf;base64,${maybeBase64}`;
    }

    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
        console.warn('No se pudo abrir la nota de cobro en una nueva pestaña (bloqueo del navegador).');
    }

    if (revoke) {
        setTimeout(revoke, 60_000);
    }
}

async function loadProveedores() {
    loadingProveedores.value = true;
    proveedoresError.value = '';
    try {
        const data = await listProveedoresAll();
        proveedores.value = Array.isArray(data) ? data : [];
    } catch (err: any) {
        proveedoresError.value = parseErrorMessage(err);
        proveedores.value = [];
    } finally {
        loadingProveedores.value = false;
    }
}

async function loadCobros() {
    cobrosLoading.value = true;
    cobrosError.value = '';
    try {
        const params: Record<string, any> = {
            page: cobrosMeta.page,
            per_page: cobrosMeta.perPage,
        };
        if (cobrosSearch.value.trim()) params.search = cobrosSearch.value.trim();
        if (cobrosMes.value) params.mes_cobro = cobrosMes.value;
        if (cobrosStatus.value) params.status = cobrosStatus.value;

        const resp = await listMensualidad(params);
        const rows = Array.isArray(resp.data) ? resp.data : [];
        cobros.value = rows;

        const meta = resp.meta ?? {};
        cobrosMeta.total = meta.total ?? rows.length;
        cobrosMeta.perPage = meta.per_page ?? cobrosMeta.perPage;
        cobrosMeta.lastPage = meta.last_page ?? (cobrosMeta.perPage ? Math.max(1, Math.ceil((meta.total ?? rows.length) / cobrosMeta.perPage)) : 1);
        cobrosMeta.page = meta.current_page ?? params.page ?? cobrosMeta.page;
    } catch (err: any) {
        cobrosError.value = parseErrorMessage(err);
        cobros.value = [];
        cobrosMeta.total = 0;
        cobrosMeta.lastPage = 1;
    } finally {
        cobrosLoading.value = false;
    }
}

function scheduleCobrosFetch() {
    if (typeof window === 'undefined') {
        cobrosMeta.page = 1;
        loadCobros();
        return;
    }
    if (cobrosFilterTimer) {
        clearTimeout(cobrosFilterTimer);
        cobrosFilterTimer = undefined;
    }
    cobrosFilterTimer = window.setTimeout(() => {
        cobrosMeta.page = 1;
        loadCobros();
    }, 350);
}

function resetCobrosFilters() {
    cobrosSearch.value = '';
    cobrosMes.value = '';
    cobrosStatus.value = '';
    cobrosMeta.page = 1;
    loadCobros();
}

function goCobrosPrev() {
    if (cobrosMeta.page <= 1) return;
    cobrosMeta.page -= 1;
    loadCobros();
}

function goCobrosNext() {
    if (cobrosMeta.page >= cobrosMeta.lastPage) return;
    cobrosMeta.page += 1;
    loadCobros();
}

function shouldFallbackToSingle(err: any) {
    const status = err?.response?.status;
    return status === 404 || status === 405 || status === 400;
}

async function runMonthlyCobros() {
    bulkState.running = true;
    bulkState.successCount = 0;
    bulkMessage.value = '';
    bulkError.value = '';
    bulkFailures.value = [];

    if (!bulkForm.mes_cobro || !bulkForm.fecha_cobro) {
        bulkError.value = 'Selecciona el mes y la fecha de cargo.';
        bulkState.running = false;
        return;
    }

    const concepto = bulkForm.concepto?.trim();
    if (!concepto) {
        bulkError.value = 'Indica un concepto para el cobro.';
        bulkState.running = false;
        return;
    }

    const objetivos = proveedoresConImporte.value;
    if (!objetivos.length) {
        bulkError.value = 'No hay proveedores con importe mensual configurado.';
        bulkState.running = false;
        return;
    }

    const nota = bulkForm.nota?.trim() || null;

    const detalles = objetivos.map((proveedor) => {
        const importe = Math.round(Number(proveedor.importe ?? 0) * 100) / 100;
        const { base64 } = generateCobroPdf(proveedor, {
            concepto,
            importe,
            fecha_cobro: bulkForm.fecha_cobro,
            mes_cobro: bulkForm.mes_cobro,
            nota,
        });
        return {
            proveedor,
            importe,
            pdfBase64: base64,
        };
    });

    const batchPayload = {
        concepto,
        mes_cobro: bulkForm.mes_cobro,
        fecha_cobro: bulkForm.fecha_cobro,
        nota,
        cobros: detalles.map(({ proveedor, importe, pdfBase64 }) => ({
            proveedor_id: proveedor.id,
            importe,
            cobro_pdf_base64: pdfBase64,
        })),
    };

    try {
        if (batchPayload.cobros.length > 1) {
            try {
                await createCobrosBatch(batchPayload);
                bulkState.successCount = batchPayload.cobros.length;
                bulkMessage.value = `Se enviaron ${batchPayload.cobros.length} cobros correspondientes a ${formatMonthLabel(
                    bulkForm.mes_cobro
                )}.`;
                return;
            } catch (batchErr: any) {
                if (!shouldFallbackToSingle(batchErr)) {
                    throw batchErr;
                }
            }
        }

        const failures: Array<{ proveedor: Proveedor; error: string }> = [];
        let success = 0;

        for (const detalle of detalles) {
            try {
                await createCobro({
                    fecha_cobro: bulkForm.fecha_cobro,
                    mes_cobro: bulkForm.mes_cobro,
                    concepto,
                    nota,
                    proveedor_id: detalle.proveedor.id,
                    importe: detalle.importe,
                    status: 'pending',
                    receipt_pdf_base64: detalle.pdfBase64,
                });
                success += 1;
            } catch (err: any) {
                const fallbackProveedor: Proveedor = detalle.proveedor;
                failures.push({
                    proveedor: fallbackProveedor,
                    error: parseErrorMessage(err),
                });
            }
        }

        bulkState.successCount = success;
        bulkFailures.value = failures;

        if (success) {
            bulkMessage.value = `Se generaron ${success} cobros.`;
        }
        if (failures.length) {
            bulkError.value = `${failures.length} cobros no pudieron enviarse.`;
        }
        if (success) {
            await loadCobros();
        }
    } catch (err: any) {
        bulkError.value = parseErrorMessage(err);
    } finally {
        bulkState.running = false;
    }
}

async function submitSingleCobro() {
    singleMessage.value = '';
    singleError.value = '';

    if (!singleForm.proveedor_id) {
        singleError.value = 'Selecciona un proveedor.';
        return;
    }

    if (!singleForm.concepto.trim()) {
        singleError.value = 'Indica un concepto.';
        return;
    }

    if (!singleForm.importe || singleForm.importe <= 0) {
        singleError.value = 'El monto debe ser mayor a cero.';
        return;
    }

    if (!singleForm.fecha_cobro) {
        singleError.value = 'Selecciona la fecha de cargo.';
        return;
    }

    if (!singleForm.mes_cobro) {
        singleError.value = 'Selecciona el mes al que aplica el cobro.';
        return;
    }

    const proveedor = proveedores.value.find((p) => p.id === singleForm.proveedor_id);
    if (!proveedor) {
        singleError.value = 'No se encontró la información del proveedor.';
        return;
    }

    singleSaving.value = true;

    try {
        const importe = Math.round(Number(singleForm.importe) * 100) / 100;
        const { base64 } = generateCobroPdf(proveedor, {
            concepto: singleForm.concepto.trim(),
            importe,
            fecha_cobro: singleForm.fecha_cobro,
            mes_cobro: singleForm.mes_cobro,
            nota: singleForm.nota?.trim(),
        });

        await createCobro({
            concepto: singleForm.concepto.trim(),
            fecha_cobro: singleForm.fecha_cobro,
            mes_cobro: singleForm.mes_cobro,
            nota: singleForm.nota?.trim() || null,
            proveedor_id: proveedor.id,
            importe,
            status: 'pending',
            receipt_pdf_base64: base64,
        });

        openPdfInNewTab(base64);

        singleMessage.value = 'Cobro enviado al backend.';
        singleForm.nota = '';
        await loadCobros();
    } catch (err: any) {
        singleError.value = parseErrorMessage(err);
    } finally {
        singleSaving.value = false;
    }
}

onMounted(() => {
    loadProveedores();
    loadCobros();
});

watch(cobrosSearch, () => scheduleCobrosFetch());
watch([cobrosMes, cobrosStatus], () => scheduleCobrosFetch());
watch(() => paymentForm.cantidad_pago, () => updateRestante());
watch(() => paymentModalOpen.value, (open) => {
    if (!open) return;
    updateRestante();
});

onUnmounted(() => {
    if (cobrosFilterTimer) {
        clearTimeout(cobrosFilterTimer);
        cobrosFilterTimer = undefined;
    }
});
</script>

<template>
    <AppLayout>
        <div class="space-y-8">
            <header class="space-y-2">
                <h1 class="text-xl font-semibold text-gray-900">Crear cobros</h1>
                <p class="text-sm text-gray-500">
                    Genera notas de cobro en PDF y envíalas al backend para su notificación por correo.
                </p>
            </header>

            <section class="grid gap-6 xl:gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div class="space-y-6">
                    <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-semibold text-gray-900">Cobro mensual automático</h2>
                            <p class="mt-1 text-sm text-gray-500">
                                Usa el importe configurado en cada proveedor para generar el cobro del mes.
                            </p>
                        </div>

                        <div class="mt-4 space-y-4">
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Mes a cobrar</span>
                                <input
                                    v-model="bulkForm.mes_cobro"
                                    type="month"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Fecha de cargo</span>
                                <input
                                    v-model="bulkForm.fecha_cobro"
                                    type="date"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </label>
                        </div>

                        <div class="mt-4 grid gap-4 sm:grid-cols-2">
                            <label class="flex flex-col text-sm text-gray-600 sm:col-span-2">
                                <span class="font-medium text-gray-700">Concepto</span>
                                <input
                                    v-model="bulkForm.concepto"
                                    type="text"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600 sm:col-span-2">
                                <span class="font-medium text-gray-700">Notas (opcional)</span>
                                <textarea
                                    v-model="bulkForm.nota"
                                    rows="3"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    placeholder="Observaciones generales para este cobro"
                                ></textarea>
                            </label>
                        </div>

                        <div class="mt-5 space-y-4">
                            <div
                                v-if="bulkMessage"
                                class="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700"
                            >
                                {{ bulkMessage }}
                            </div>
                            <div
                                v-if="bulkError"
                                class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
                            >
                                {{ bulkError }}
                            </div>
                            <div
                                v-if="bulkFailures.length"
                                class="rounded-lg border border-yellow-100 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
                            >
                                <p class="font-medium">Cobros pendientes de reintentar:</p>
                                <ul class="mt-2 space-y-1 text-yellow-700">
                                    <li v-for="item in bulkFailures" :key="item.proveedor.id">
                                        {{ item.proveedor.nombre }} — {{ item.error }}
                                    </li>
                                </ul>
                            </div>

                            <div
                                class="flex flex-col justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 shadow-sm sm:flex-row sm:items-center"
                            >
                                <div>
                                    <p class="text-gray-500">
                                        Proveedores programados:
                                        <span class="font-semibold text-gray-900">{{ proveedoresConImporte.length }}</span>
                                    </p>
                                    <p>Total estimado: <span class="font-semibold text-gray-900">{{ formatCurrency(totalMensual) }}</span></p>
                                </div>
                                <button
                                    type="button"
                                    class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                                    :disabled="!canRunBulk"
                                    @click="runMonthlyCobros"
                                >
                                    <span v-if="bulkState.running">Generando cobros…</span>
                                    <span v-else>Generar cobros del mes</span>
                                </button>
                            </div>

                            <div class="max-h-[360px] overflow-hidden rounded-lg border border-gray-100">
                                <div v-if="loadingProveedores" class="px-4 py-5 text-sm text-gray-500">
                                    Cargando proveedores…
                                </div>
                                <div v-else-if="proveedoresError" class="px-4 py-5 text-sm text-red-600">
                                    {{ proveedoresError }}
                                </div>
                                <template v-else>
                                    <div v-if="proveedoresConImporte.length" class="divide-y divide-gray-100 bg-white">
                                        <div
                                            v-for="proveedor in proveedoresConImporte"
                                            :key="proveedor.id"
                                            class="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div>
                                                <p class="font-medium text-gray-900">{{ proveedor.nombre }}</p>
                                                <p class="text-xs text-gray-500">Identificador: {{ proveedor.ident }}</p>
                                            </div>
                                            <div class="text-sm text-gray-600 sm:text-right">
                                                <p class="font-semibold text-gray-900">
                                                    {{ formatCurrency(Number(proveedor.importe ?? 0)) }}
                                                </p>
                                                <p v-if="proveedor.email" class="text-xs text-gray-400 sm:max-w-[240px] sm:truncate">
                                                    {{ proveedor.email }}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div v-else class="px-4 py-5 text-sm text-gray-500">
                                        Ningún proveedor tiene importe mensual asignado.
                                    </div>
                                </template>
                            </div>

                            <div
                                v-if="!loadingProveedores && proveedoresSinImporte.length"
                                class="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500"
                            >
                                {{ proveedoresSinImporte.length }} proveedores no tienen importe mensual y no se incluyen
                                automáticamente.
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <h2 class="text-lg font-semibold text-gray-900">Cobro individual</h2>
                        <p class="mt-1 text-sm text-gray-500">
                            Genera un cobro puntual personalizando el concepto, monto y notas.
                        </p>

                        <form class="mt-4 space-y-4" @submit.prevent="submitSingleCobro">
                            <div class="space-y-2">
                                <label class="text-sm font-medium text-gray-700">Proveedor</label>
                                <select
                                    v-model.number="singleForm.proveedor_id"
                                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-gray-900 focus:ring-gray-900"
                                >
                                    <option value="" disabled>Selecciona un proveedor</option>
                                    <option
                                        v-for="proveedor in proveedoresOrdenados"
                                        :key="proveedor.id"
                                        :value="proveedor.id"
                                    >
                                        {{ proveedor.nombre }}
                                    </option>
                                </select>
                            </div>

                            <div
                                v-if="proveedorSeleccionado"
                                class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600"
                            >
                                <p class="font-medium text-gray-900">{{ proveedorSeleccionado.nombre }}</p>
                                <p class="mt-1">
                                    Monto mensual sugerido:
                                    <span class="font-semibold text-gray-900">
                                        {{ formatCurrency(Number(proveedorSeleccionado.importe ?? 0)) }}
                                    </span>
                                </p>
                                <p v-if="proveedorSeleccionado.email">Correo: {{ proveedorSeleccionado.email }}</p>
                            </div>

                            <div class="space-y-2">
                                <label class="text-sm font-medium text-gray-700">Concepto</label>
                                <input
                                    v-model="singleForm.concepto"
                                    type="text"
                                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </div>

                            <div class="grid gap-4 sm:grid-cols-2">
                                <label class="flex flex-col text-sm text-gray-600">
                                    <span class="font-medium text-gray-700">Monto</span>
                                    <input
                                        v-model.number="singleForm.importe"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    />
                                </label>
                                <label class="flex flex-col text-sm text-gray-600">
                                    <span class="font-medium text-gray-700">Mes aplicado</span>
                                    <input
                                        v-model="singleForm.mes_cobro"
                                        type="month"
                                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    />
                                </label>
                            </div>

                            <div class="grid gap-4 sm:grid-cols-2">
                                <label class="flex flex-col text-sm text-gray-600">
                                    <span class="font-medium text-gray-700">Fecha de cargo</span>
                                    <input
                                        v-model="singleForm.fecha_cobro"
                                        type="date"
                                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    />
                                </label>
                                <label class="flex flex-col text-sm text-gray-600">
                                    <span class="font-medium text-gray-700">Notas (opcional)</span>
                                    <textarea
                                        v-model="singleForm.nota"
                                        rows="3"
                                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                        placeholder="Observaciones adicionales para el proveedor"
                                    ></textarea>
                                </label>
                            </div>

                            <div
                                v-if="singleMessage"
                                class="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700"
                            >
                                {{ singleMessage }}
                            </div>
                            <div
                                v-if="singleError"
                                class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
                            >
                                {{ singleError }}
                            </div>

                            <button
                                type="submit"
                                class="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                                :disabled="singleSaving"
                            >
                                <span v-if="singleSaving">Generando cobro…</span>
                                <span v-else>Crear cobro individual</span>
                            </button>
                        </form>
                    </div>
                </div>
            </section>

            <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <header class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h2 class="text-lg font-semibold text-gray-900">Cobros registrados</h2>
                        <p class="text-sm text-gray-500">Revisa los cobros generados, ya sean individuales o en lote.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                        <label class="flex flex-col">
                            <span class="font-medium text-gray-700">Buscar</span>
                            <input
                                v-model="cobrosSearch"
                                type="search"
                                class="mt-1 w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                placeholder="Proveedor, concepto…"
                            />
                        </label>
                        <label class="flex flex-col">
                            <span class="font-medium text-gray-700">Mes</span>
                            <input
                                v-model="cobrosMes"
                                type="month"
                                class="mt-1 w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            />
                        </label>
                        <label class="flex flex-col">
                            <span class="font-medium text-gray-700">Estado</span>
                            <select
                                v-model="cobrosStatus"
                                class="mt-1 w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            >
                                <option value="">Todos</option>
                                <option value="pending">Pendiente</option>
                                <option value="paid">Pagado</option>
                                <option value="failed">Rechazado</option>
                            </select>
                        </label>
                        <div class="mt-6 flex items-center gap-2">
                            <button
                                type="button"
                                class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                                @click="loadCobros"
                            >
                                Actualizar
                            </button>
                            <button
                                type="button"
                                class="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                                @click="resetCobrosFilters"
                            >
                                Limpiar
                            </button>
                        </div>
                    </div>
                </header>

                <div class="mt-5">
                    <div class="-mx-3 overflow-x-auto">
                        <div class="inline-block min-w-full align-middle px-3">
                            <div class="overflow-hidden rounded-xl border border-gray-200">
                                <table class="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th class="px-4 py-3 text-left font-medium">Proveedor</th>
                                            <th class="px-4 py-3 text-left font-medium">Concepto</th>
                                            <th class="px-4 py-3 text-left font-medium">Importe</th>
                                            <th class="px-4 py-3 text-left font-medium">Mes</th>
                                            <th class="px-4 py-3 text-left font-medium">Fecha cobro</th>
                                            <th class="px-4 py-3 text-left font-medium">Estado</th>
                                            <th class="px-4 py-3 text-left font-medium">Origen</th>
                                            <th class="px-4 py-3 text-left font-medium">Nota de cobro</th>
                                            <th class="px-4 py-3 text-left font-medium">Comprobante de pago</th>
                                            <th class="px-4 py-3 text-left font-medium">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-100">
                                        <tr v-if="cobrosError">
                                            <td colspan="10" class="px-4 py-6 text-center text-sm text-rose-600">
                                                {{ cobrosError }}
                                            </td>
                                        </tr>
                                        <tr v-else-if="!cobrosLoading && !cobros.length">
                                            <td colspan="10" class="px-4 py-6 text-center text-sm text-gray-500">
                                                No hay cobros registrados con los filtros seleccionados.
                                            </td>
                                        </tr>
                                        <tr v-for="c in cobros" :key="c.id" class="hover:bg-gray-50">
                                            <td class="px-4 py-3">
                                                <div class="font-medium text-gray-900">{{ c.proveedor_nombre ?? `Proveedor #${c.proveedor_id}` }}</div>
                                                <div class="text-xs text-gray-500">ID interno: {{ c.proveedor_ident ?? c.proveedor_id }}</div>
                                            </td>
                                            <td class="px-4 py-3">
                                                <div class="text-gray-800">{{ c.concepto }}</div>
                                                <div v-if="c.nota" class="mt-1 text-xs text-gray-500 line-clamp-2">{{ c.nota }}</div>
                                            </td>
                                            <td class="px-4 py-3 font-medium text-gray-900">{{ formatCurrency(Number(c.importe ?? 0)) }}</td>
                                            <td class="px-4 py-3 text-sm text-gray-600">{{ formatMonthLabel(c.mes_cobro) }}</td>
                                            <td class="px-4 py-3 text-sm text-gray-600">{{ formatDateLabel(c.fecha_cobro) }}</td>
                                            <td class="px-4 py-3">
                                                <span
                                                    class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
                                                    :class="statusBadgeClass(c.status)"
                                                >
                                                    {{ formatStatus(c.status) }}
                                                </span>
                                                <div v-if="c.payment_date" class="mt-1 text-xs text-gray-500">
                                                    Pago: {{ formatDateLabel(c.payment_date) }}
                                                </div>
                                            </td>
                                            <td class="px-4 py-3 text-sm text-gray-600 capitalize">
                                                {{ c.origen ? c.origen : (c.status ? 'individual' : '—') }}
                                            </td>
                                            <td class="px-4 py-3 text-sm text-gray-600">
                                                <template v-if="c.cobro_path">
                                                    <button
                                                        type="button"
                                                        class="inline-flex items-center gap-1 text-sm text-gray-700 underline underline-offset-4 hover:text-gray-900"
                                                        @click="openPdfInNewTab(c.cobro_path)"
                                                    >
                                                        Ver PDF
                                                    </button>
                                                </template>
                                                <span v-else class="text-xs text-gray-400">Sin archivo</span>
                                            </td>
                                            <td class="px-4 py-3 text-sm text-gray-600">
                                                <template v-if="c.receipt_path || c.receipt_path">
                                                    <button
                                                        type="button"
                                                        class="inline-flex items-center gap-1 text-sm text-gray-700 underline underline-offset-4 hover:text-gray-900"
                                                        @click="openPdfInNewTab(c.receipt_path ?? c.receipt_path ?? '')"
                                                    >
                                                        Ver PDF
                                                    </button>
                                                </template>
                                                <span v-else class="text-xs text-gray-400">Sin registro</span>
                                            </td>
                                            <td class="px-4 py-3 text-sm text-gray-600">
                                                <div class="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                        @click="openPaymentModal(c)"
                                                    >
                                                        Registrar pago
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        <tr v-if="cobrosLoading">
                                            <td colspan="10" class="px-4 py-6 text-center text-sm text-gray-500">
                                                Cargando cobros…
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-600">
                        <div>
                            Mostrando página {{ cobrosMeta.page }} de {{ cobrosMeta.lastPage }} ({{ cobrosMeta.total }} registros)
                        </div>
                        <div class="flex items-center gap-2">
                            <button
                                type="button"
                                class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:border-gray-200"
                                :disabled="cobrosMeta.page <= 1"
                                @click="goCobrosPrev"
                            >
                                Anterior
                            </button>
                            <span class="text-sm text-gray-500">Página {{ cobrosMeta.page }}</span>
                            <button
                                type="button"
                                class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:border-gray-200"
                                :disabled="cobrosMeta.page >= cobrosMeta.lastPage"
                                @click="goCobrosNext"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <transition name="fade">
            <div
                v-if="paymentModalOpen"
                class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
            >
                <div class="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
                    <header class="flex items-start justify-between border-b border-gray-200 px-6 py-4">
                        <div>
                            <h3 class="text-lg font-semibold text-gray-900">Registrar pago</h3>
                            <p class="text-sm text-gray-500" v-if="paymentForm.concepto">
                                {{ paymentForm.concepto }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                            @click="closePaymentModal"
                        >
                            Cerrar
                        </button>
                    </header>

                    <form class="px-6 py-5 space-y-4" @submit.prevent="submitPayment">
                        <div class="grid gap-4 sm:grid-cols-2">
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Importe original</span>
                                <input
                                    :value="formatCurrency(paymentForm.importe)"
                                    type="text"
                                    class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                                    disabled
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Cantidad pagada</span>
                                <input
                                    v-model.number="paymentForm.cantidad_pago"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Restante</span>
                                <input
                                    :value="paymentForm.restante ?? ''"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                                    disabled
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600">
                                <span class="font-medium text-gray-700">Fecha de pago</span>
                                <input
                                    v-model="paymentForm.payment_date"
                                    type="date"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                />
                            </label>
                        </div>

                        <div class="grid gap-4 sm:grid-cols-2">
                            <label class="flex flex-col text-sm text-gray-600 sm:col-span-2">
                                <span class="font-medium text-gray-700">Asunto (opcional)</span>
                                <input
                                    v-model="paymentForm.subject"
                                    type="text"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    placeholder="Pago mensualidad noviembre"
                                />
                            </label>
                            <label class="flex flex-col text-sm text-gray-600 sm:col-span-2">
                                <span class="font-medium text-gray-700">Mensaje (opcional)</span>
                                <textarea
                                    v-model="paymentForm.message"
                                    rows="3"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                                    placeholder="Gracias por confirmar el pago."
                                ></textarea>
                            </label>
                        </div>

                        <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                            El sistema generará automáticamente el comprobante en PDF con la información anterior y lo enviará al proveedor.
                        </div>

                        <div v-if="paymentMessage" class="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
                            {{ paymentMessage }}
                        </div>
                        <div v-if="paymentError" class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                            {{ paymentError }}
                        </div>

                        <div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                class="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
                                @click="closePaymentModal"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                                :disabled="paymentSaving"
                            >
                                <span v-if="paymentSaving">Guardando…</span>
                                <span v-else>Registrar pago</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </transition>
    </AppLayout>
</template>
