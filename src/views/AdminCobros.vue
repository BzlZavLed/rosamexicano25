<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import { listProveedores, type Proveedor } from '../api/proveedores';
import { listCobros, createCobro, payCobro, bulkCreateMensualidad, type Cobro, type CobroStatus } from '../api/cobros';
import { jsPDF } from 'jspdf';

const PER_PAGE = 20;

const proveedores = ref<Proveedor[]>([]);
const proveedoresLoading = ref(false);

const cobros = ref<Cobro[]>([]);
const cobrosLoading = ref(false);
const cobrosError = ref('');
const search = ref('');
const statusFilter = ref<CobroStatus | 'all'>('all');

const pagination = reactive({
    page: 1,
    perPage: PER_PAGE,
    total: 0,
    lastPage: 1,
});

const bulkForm = reactive({
    mesCobro: new Date().toISOString().slice(0, 7),
    fechaCobro: new Date().toISOString().slice(0, 10),
    concepto: 'Cobro mensual',
});
const bulkSaving = ref(false);
const bulkError = ref('');
const bulkMessage = ref('');

const message = ref('');
const formError = ref('');
const saving = ref(false);

const manualModalOpen = ref(false);

const form = reactive({
    proveedorId: null as number | null,
    fechaCobro: new Date().toISOString().slice(0, 10),
    mesCobro: new Date().toISOString().slice(0, 7),
    importe: 0,
    concepto: '',
    nota: '',
});

const paymentModalOpen = ref(false);
const paymentSaving = ref(false);
const paymentError = ref('');
const selectedCobro = ref<Cobro | null>(null);
const paymentForm = reactive({
    metodo: 'efectivo',
    monto: 0,
    fechaPago: new Date().toISOString().slice(0, 10),
    nota: '',
    enviarTicket: true,
    imprimirRecibo: true,
});

let searchTimer: number | undefined;

const providerOptions = computed(() =>
    proveedores.value.map(p => ({
        value: p.id,
        label: p.nombre || `Proveedor #${p.ident}`,
        importe: Number((p as any)?.importe ?? 0) || 0,
    }))
);

const providerNameMap = computed<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (const p of proveedores.value) {
        map[p.id] = p.nombre || `Proveedor #${p.ident}`;
    }
    return map;
});

const selectedProvider = computed(() =>
    providerOptions.value.find(opt => opt.value === form.proveedorId) || null
);

const pageInfo = computed(() => {
    if (!pagination.total) return null;
    const start = (pagination.page - 1) * pagination.perPage + 1;
    const end = Math.min(start + pagination.perPage - 1, pagination.total);
    return { start, end };
});

const canPrev = computed(() => pagination.page > 1);
const canNext = computed(() => pagination.page < pagination.lastPage);

function statusBadge(status: CobroStatus) {
    switch (status) {
        case 'paid':
            return { text: 'Pagado', class: 'bg-emerald-100 border-emerald-200 text-emerald-700' };
        case 'overdue':
            return { text: 'Vencido', class: 'bg-rose-100 border-rose-200 text-rose-700' };
        default:
            return { text: 'Pendiente', class: 'bg-amber-100 border-amber-200 text-amber-700' };
    }
}

function formatMoney(amount: number) {
    try {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount ?? 0);
    } catch {
        return `$${Number(amount ?? 0).toFixed(2)}`;
    }
}

function formatDate(fecha?: string | null) {
    if (!fecha) return '—';
    const parsed = new Date(fecha.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return fecha;
    return parsed.toLocaleDateString('es-MX', { dateStyle: 'medium' });
}

function formatMonth(month: string) {
    if (!month) return '—';
    const [year, mm] = month.split('-');
    if (!year || !mm) return month;
    const date = new Date(Number(year), Number(mm) - 1, 1);
    if (Number.isNaN(date.getTime())) return month;
    return date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function isValidUrl(url?: string | null) {
    if (!url) return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function openLink(url: string) {
    if (!isValidUrl(url)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function buildCobroReceiptPDF(cobro: Cobro, pago: { metodo: string; monto: number; fechaPago: string }) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const titleY = 20;
    const line = (y: number) => {
        doc.setDrawColor(220);
        doc.line(15, y, 200, y);
    };

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Recibo de cobro a proveedor', 15, titleY);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Proveedor: ${cobro.proveedor_nombre}`, 15, titleY + 8);
    doc.text(`Cobro ID: ${cobro.id}`, 15, titleY + 14);
    doc.text(`Mes: ${formatMonth(cobro.mes_cobro)}`, 15, titleY + 20);
    doc.text(`Fecha programada: ${formatDate(cobro.fecha_cobro)}`, 15, titleY + 26);
    if (cobro.concepto) doc.text(`Concepto: ${cobro.concepto}`, 15, titleY + 32);
    if (cobro.nota) {
        doc.setFontSize(9);
        doc.text(`Nota: ${cobro.nota}`, 15, titleY + 38);
        doc.setFontSize(10);
    }

    line(titleY + 42);

    const paymentY = titleY + 50;
    doc.setFont('helvetica', 'bold'); doc.text('Pago registrado', 15, paymentY);
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha de pago: ${formatDate(pago.fechaPago)}`, 15, paymentY + 8);
    doc.text(`Método: ${pago.metodo.toUpperCase()}`, 15, paymentY + 14);
    doc.text(`Monto: ${formatMoney(pago.monto)}`, 15, paymentY + 20);

    doc.setFontSize(9);
    doc.text('Gracias por tu pago.', 105, paymentY + 36, { align: 'center' });

    return doc;
}

function buildCobroProgramPDF(details: {
    proveedorNombre: string;
    proveedorId?: number | null;
    fecha: string;
    mes: string;
    importe: number;
    concepto: string;
    nota?: string | null;
}) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const titleY = 20;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Programación de cobro a proveedor', 15, titleY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Proveedor: ${details.proveedorNombre}${details.proveedorId ? ` (#${details.proveedorId})` : ''}`, 15, titleY + 8);
    doc.text(`Concepto: ${details.concepto}`, 15, titleY + 14);
    doc.text(`Mes a cobrar: ${formatMonth(details.mes)}`, 15, titleY + 20);
    doc.text(`Fecha del cobro: ${formatDate(details.fecha)}`, 15, titleY + 26);
    doc.text(`Importe programado: ${formatMoney(details.importe)}`, 15, titleY + 32);
    if (details.nota) {
        doc.text(`Nota: ${details.nota}`, 15, titleY + 38);
    }
    doc.setFontSize(9);
    doc.text('Generado automáticamente por el sistema de caja.', 15, titleY + 48);
    return doc;
}

function buildCobroBulkPDF(details: { mes: string; fecha: string; concepto: string }) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const titleY = 20;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Generación de cobros mensuales', 15, titleY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Concepto global: ${details.concepto}`, 15, titleY + 8);
    doc.text(`Mes programado: ${formatMonth(details.mes)}`, 15, titleY + 14);
    doc.text(`Fecha de notificación: ${formatDate(details.fecha)}`, 15, titleY + 20);
    doc.text(`Total proveedores: ${proveedores.value.length}`, 15, titleY + 26);
    doc.setFontSize(9);
    doc.text('Cada proveedor recibirá el cobro con el importe configurado en su ficha.', 15, titleY + 36);
    return doc;
}

function printCobro(cobro: Cobro) {
    if (cobro.status !== 'paid') return;
    const doc = buildCobroReceiptPDF(cobro, {
        metodo: (cobro.pago_metodo || 'pendiente'),
        monto: Number(cobro.importe),
        fechaPago: cobro.pago_fecha || cobro.fecha_cobro,
    });
    doc.save(`cobro_${cobro.id}.pdf`);
}

async function loadProveedores() {
    proveedoresLoading.value = true;
    try {
        const data = await listProveedores({ per_page: 200 });
        const rows = Array.isArray((data as any)?.data)
            ? (data as any).data
            : Array.isArray(data)
                ? data
                : [];
        proveedores.value = rows;
    } catch (e: any) {
        console.error('No se pudo cargar proveedores', e?.response ?? e);
    } finally {
        proveedoresLoading.value = false;
    }
}

async function loadCobros() {
    cobrosLoading.value = true;
    cobrosError.value = '';
    try {
        const params: Record<string, any> = {
            page: pagination.page,
            per_page: pagination.perPage,
        };
        if (search.value.trim()) params.search = search.value.trim();
        if (statusFilter.value !== 'all') params.status = statusFilter.value;

        const resp = await listCobros(params);
        const rows = (Array.isArray((resp as any)?.data)
            ? (resp as any).data
            : Array.isArray(resp)
                ? resp
                : []) as Cobro[];

        cobros.value = rows.map((row: Cobro) => ({
            ...row,
            proveedor_nombre: row.proveedor_nombre || providerNameMap.value[row.proveedor_id] || `Proveedor #${row.proveedor_id}`,
        }));

        const meta = (resp as any)?.meta ?? null;
        const total = meta?.total ?? (resp as any)?.total ?? rows.length;
        const lastPage = meta?.last_page ?? (resp as any)?.last_page ?? (total ? Math.ceil(total / pagination.perPage) : 1);

        pagination.total = total ?? rows.length;
        pagination.lastPage = Math.max(1, lastPage || 1);

        if (pagination.page > pagination.lastPage) {
            const newPage = Math.max(1, pagination.lastPage);
            if (newPage !== pagination.page) {
                pagination.page = newPage;
            }
            return;
        }
    } catch (e: any) {
        cobrosError.value = e?.response?.data?.message || 'No se pudo cargar los cobros';
        cobros.value = [];
        pagination.total = 0;
        pagination.lastPage = 1;
    } finally {
        cobrosLoading.value = false;
    }
}

function scheduleFetch() {
    if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = undefined;
    }
    searchTimer = window.setTimeout(loadCobros, 350);
}

async function submitBulkCobros() {
    bulkError.value = '';
    bulkMessage.value = '';

    const mes = bulkForm.mesCobro;
    const fecha = bulkForm.fechaCobro;
    const concepto = bulkForm.concepto.trim();

    if (!mes) {
        bulkError.value = 'Selecciona el mes que deseas cobrar';
        return;
    }
    if (!fecha) {
        bulkError.value = 'Selecciona la fecha del cobro';
        return;
    }
    if (!concepto) {
        bulkError.value = 'Proporciona un concepto para los cobros';
        return;
    }

    bulkSaving.value = true;
    try {
        const doc = buildCobroBulkPDF({ mes, fecha, concepto });
        const dataUri = doc.output('datauristring');
        const cobroPdfBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        const perProviderDocs = proveedores.value.map((prov) => {
            const importe = Number((prov as any)?.importe ?? 0) || 0;
            const providerDoc = buildCobroProgramPDF({
                proveedorNombre: prov.nombre || `Proveedor #${prov.ident}`,
                proveedorId: prov.id,
                fecha,
                mes,
                importe,
                concepto,
                nota: null,
            });
            const providerUri = providerDoc.output('datauristring');
            const providerBase64 = providerUri.includes(',') ? (providerUri.split(',')[1] || '') : providerUri;
            return {
                proveedor_id: prov.id,
                importe,
                cobro_pdf_base64: providerBase64,
            };
        });

        await bulkCreateMensualidad({
            mes_cobro: mes,
            fecha_cobro: fecha,
            concepto,
            cobro_pdf_base64: cobroPdfBase64,
            cobros: perProviderDocs,
        });
        bulkMessage.value = 'Cobros mensuales generados';
        await loadCobros();
    } catch (e: any) {
        bulkError.value = e?.response?.data?.message || 'No se pudieron generar los cobros mensuales';
    } finally {
        bulkSaving.value = false;
    }
}

async function submitCobro() {
    formError.value = '';
    message.value = '';

    if (!form.proveedorId) {
        formError.value = 'Selecciona un proveedor';
        return;
    }
    if (!form.fechaCobro) {
        formError.value = 'Selecciona la fecha del cobro';
        return;
    }
    if (!form.mesCobro) {
        formError.value = 'Selecciona el mes a cobrar';
        return;
    }
    if (!form.importe || form.importe <= 0) {
        formError.value = 'El importe debe ser mayor a 0';
        return;
    }
    const concepto = form.concepto.trim();
    if (!concepto) {
        formError.value = 'Indica el concepto del cobro';
        return;
    }

    saving.value = true;
    try {
        const providerName = providerNameMap.value[form.proveedorId] || `Proveedor #${form.proveedorId}`;
        const doc = buildCobroProgramPDF({
            proveedorNombre: providerName,
            proveedorId: form.proveedorId,
            fecha: form.fechaCobro,
            mes: form.mesCobro,
            importe: Number(form.importe),
            concepto,
            nota: form.nota.trim() || null,
        });
        const dataUri = doc.output('datauristring');
        const cobroPdfBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

        await createCobro({
            proveedor_id: form.proveedorId,
            fecha_cobro: form.fechaCobro,
            mes_cobro: form.mesCobro,
            importe: Number(form.importe),
            concepto,
            nota: form.nota.trim() || null,
            cobro_pdf_base64: cobroPdfBase64,
        });
        const blobUrl = doc.output('bloburl');
        const printWindow = window.open(blobUrl, '_blank');
        if (!printWindow) {
            doc.save(`cobro_${form.proveedorId}_${Date.now()}.pdf`);
        } else {
            printWindow.focus();
        }
        message.value = 'Cobro creado';
        manualModalOpen.value = false;
        await loadCobros();
        resetForm();
    } catch (e: any) {
        formError.value = e?.response?.data?.message || 'No se pudo crear el cobro';
    } finally {
        saving.value = false;
    }
}

function resetForm() {
    form.proveedorId = null;
    form.fechaCobro = new Date().toISOString().slice(0, 10);
    form.mesCobro = new Date().toISOString().slice(0, 7);
    form.importe = 0;
    form.concepto = '';
    form.nota = '';
    formError.value = '';
}

function onProviderChange() {
    const provider = selectedProvider.value;
    if (provider) {
        form.importe = provider.importe;
    }
}

function openManualModal() {
    resetForm();
    manualModalOpen.value = true;
}

function closeManualModal() {
    if (saving.value) return;
    manualModalOpen.value = false;
}

function openPaymentModal(cobro: Cobro) {
    selectedCobro.value = cobro;
    paymentForm.metodo = 'efectivo';
    paymentForm.monto = Number(cobro.importe);
    paymentForm.fechaPago = new Date().toISOString().slice(0, 10);
    paymentForm.nota = '';
    paymentForm.enviarTicket = true;
    paymentForm.imprimirRecibo = true;
    paymentError.value = '';
    paymentSaving.value = false;
    paymentModalOpen.value = true;
}

function closePaymentModal() {
    if (paymentSaving.value) return;
    paymentModalOpen.value = false;
    selectedCobro.value = null;
}

async function submitPayment() {
    if (!selectedCobro.value) return;

    paymentError.value = '';
    if (!paymentForm.metodo) {
        paymentError.value = 'Selecciona un método de pago';
        return;
    }
    if (!paymentForm.monto || paymentForm.monto <= 0) {
        paymentError.value = 'El monto debe ser mayor a 0';
        return;
    }
    if (!paymentForm.fechaPago) {
        paymentError.value = 'Selecciona la fecha de pago';
        return;
    }

    paymentSaving.value = true;
    try {
        const doc = buildCobroReceiptPDF(selectedCobro.value, {
            metodo: paymentForm.metodo,
            monto: Number(paymentForm.monto),
            fechaPago: paymentForm.fechaPago,
        });
        const dataUri = doc.output('datauristring');
        const receiptPdfBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

        await payCobro(selectedCobro.value.id, {
            metodo: paymentForm.metodo,
            monto: Number(paymentForm.monto),
            fecha_pago: paymentForm.fechaPago,
            nota: paymentForm.nota.trim() || null,
            enviar_ticket: paymentForm.enviarTicket,
            proveedor_id: selectedCobro.value.proveedor_id,
            receipt_pdf_base64: receiptPdfBase64,
        });
        message.value = 'Pago registrado';
        if (paymentForm.imprimirRecibo) {
            doc.autoPrint();
            const blobUrl = doc.output('bloburl');
            const printWindow = window.open(blobUrl, '_blank');
            if (!printWindow) {
                doc.save(`cobro_${selectedCobro.value.id}.pdf`);
            } else {
                printWindow.focus();
            }
        }
        paymentModalOpen.value = false;
        selectedCobro.value = null;
        await loadCobros();
    } catch (e: any) {
        paymentError.value = e?.response?.data?.message || 'No se pudo registrar el pago';
    } finally {
        paymentSaving.value = false;
    }
}

function goToPage(page: number) {
    if (page < 1 || page > pagination.lastPage || page === pagination.page) return;
    pagination.page = page;
}

watch(search, () => {
    pagination.page = 1;
    scheduleFetch();
});

watch(statusFilter, () => {
    pagination.page = 1;
    loadCobros();
});

watch(() => pagination.page, (newVal, oldVal) => {
    if (oldVal === undefined || newVal === oldVal) return;
    loadCobros();
});

watch(() => form.proveedorId, onProviderChange);

onMounted(() => {
    loadProveedores();
    loadCobros();
});

onUnmounted(() => {
    if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = undefined;
    }
});
</script>

<template>
    <AppLayout>
        <div class="space-y-6">
            <header class="space-y-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 class="text-xl font-semibold text-gray-900">Cobros a proveedores</h1>
                        <p class="text-sm text-gray-500">Genera los cobros mensuales globales o crea cargos manuales para casos especiales.</p>
                    </div>
                    <button
                        type="button"
                        class="inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 text-sm"
                        @click="openManualModal"
                    >
                        Crear cobro manual
                    </button>
                </div>
                <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                        v-model="search"
                        type="search"
                        placeholder="Buscar por proveedor, mes o estado…"
                        class="w-full sm:w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                    />
                    <select
                        v-model="statusFilter"
                        class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                    >
                        <option value="all">Todos</option>
                        <option value="pending">Pendientes</option>
                        <option value="paid">Pagados</option>
                        <option value="overdue">Vencidos</option>
                    </select>
                </div>
            </header>

            <div v-if="message" class="rounded border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
                {{ message }}
            </div>

            <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
                <div>
                    <h2 class="text-lg font-semibold text-gray-900">Generar cobros mensuales</h2>
                    <p class="text-xs text-gray-500 mt-1">Se crearán cobros para todos los proveedores usando el importe definido en su ficha.</p>
                </div>

                <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Mes a cobrar</label>
                        <input
                            v-model="bulkForm.mesCobro"
                            type="month"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                        />
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Fecha del cobro</label>
                        <input
                            v-model="bulkForm.fechaCobro"
                            type="date"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                        />
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Concepto</label>
                        <input
                            v-model="bulkForm.concepto"
                            type="text"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            placeholder="Cobro mensual"
                        />
                    </div>
                </div>

                <div class="flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        class="inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 text-sm disabled:opacity-60"
                        :disabled="bulkSaving"
                        @click="submitBulkCobros"
                    >
                        {{ bulkSaving ? 'Generando…' : 'Generar cobros' }}
                    </button>
                </div>

                <div v-if="bulkMessage" class="rounded border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
                    {{ bulkMessage }}
                </div>
                <div v-if="bulkError" class="rounded border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                    {{ bulkError }}
                </div>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div class="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div class="text-sm text-gray-600">
                        <span v-if="cobrosLoading">Cargando cobros…</span>
                        <span v-else-if="pageInfo">Mostrando {{ pageInfo.start }} - {{ pageInfo.end }} de {{ pagination.total }}</span>
                        <span v-else>Sin registros</span>
                        </div>
                        <div class="flex items-center gap-2 text-sm">
                            <button
                                type="button"
                                class="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                                :disabled="cobrosLoading || !canPrev"
                                @click="goToPage(pagination.page - 1)"
                            >
                                Anterior
                            </button>
                            <div class="text-xs text-gray-500">
                                Página {{ pagination.page }} / {{ pagination.lastPage }}
                            </div>
                            <button
                                type="button"
                                class="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                                :disabled="cobrosLoading || !canNext"
                                @click="goToPage(pagination.page + 1)"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200 text-sm">
                            <thead class="bg-gray-50 text-gray-600 uppercase text-xs tracking-wide">
                                <tr>
                                    <th class="px-4 py-3 text-left font-medium">Proveedor</th>
                                    <th class="px-4 py-3 text-left font-medium">Mes</th>
                                    <th class="px-4 py-3 text-left font-medium">Concepto</th>
                                    <th class="px-4 py-3 text-left font-medium">Importe</th>
                                    <th class="px-4 py-3 text-left font-medium">Estado</th>
                                    <th class="px-4 py-3 text-left font-medium">Fecha cobro</th>
                                    <th class="px-4 py-3 text-center font-medium">Cobro</th>
                                    <th class="px-4 py-3 text-left font-medium">Pago</th>
                                    <th class="px-4 py-3 text-center font-medium">Recibo</th>
                                    <th class="px-4 py-3 text-right font-medium"></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">
                                <tr v-if="cobrosError">
                                    <td colspan="9" class="px-4 py-6 text-center text-rose-600">{{ cobrosError }}</td>
                                </tr>
                                <tr v-else-if="!cobrosLoading && cobros.length === 0">
                                    <td colspan="9" class="px-4 py-6 text-center text-gray-500">No hay cobros registrados.</td>
                                </tr>
                                <tr v-for="cobro in cobros" :key="cobro.id">
                                    <td class="px-4 py-3">
                                        <div class="font-medium text-gray-800">{{ cobro.proveedor_nombre }}</div>
                                        <div class="text-xs text-gray-500">#{{ cobro.proveedor_id }}</div>
                                    </td>
                                    <td class="px-4 py-3 text-gray-700">{{ formatMonth(cobro.mes_cobro) }}</td>
                                    <td class="px-4 py-3 text-gray-700">{{ cobro.concepto || 'Cobro' }}</td>
                                    <td class="px-4 py-3 text-gray-800 font-semibold">{{ formatMoney(cobro.importe) }}</td>
                                    <td class="px-4 py-3">
                                        <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
                                            :class="statusBadge(cobro.status).class">
                                            {{ statusBadge(cobro.status).text }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-600">{{ formatDate(cobro.fecha_cobro) }}</td>
                                    <td class="px-4 py-3 text-center">
                                        <template v-if="isValidUrl(cobro.cobro_pdf_url)">
                                            <button
                                                type="button"
                                                class="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
                                                @click="openLink(cobro.cobro_pdf_url!)"
                                            >
                                                Ver cobro
                                            </button>
                                        </template>
                                        <span v-else class="text-xs text-amber-600 uppercase tracking-wide">Sin PDF</span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-600">
                                        <div v-if="cobro.status === 'paid'">
                                            <div>{{ formatDate(cobro.pago_fecha) }}</div>
                                            <div class="text-xs text-gray-500 capitalize">{{ cobro.pago_metodo }}</div>
                                        </div>
                                        <div v-else>Pendiente</div>
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <button
                                            v-if="cobro.status === 'paid'"
                                            type="button"
                                            class="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
                                            @click="printCobro(cobro)"
                                        >
                                            Imprimir
                                        </button>
                                        <span v-else class="text-xs text-gray-400">—</span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button
                                            v-if="cobro.status === 'pending'"
                                            type="button"
                                            class="inline-flex items-center rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 text-xs"
                                            @click="openPaymentModal(cobro)"
                                        >
                                            Registrar pago
                                        </button>
                                        <span v-else class="text-xs text-gray-400">—</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
            </section>
        </div>

        <div v-if="manualModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" @click.self="closeManualModal">
            <div class="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h2 class="text-lg font-semibold text-gray-900">Crear cobro manual</h2>
                        <p class="text-xs text-gray-500 mt-1">Define el cargo y el importe para un proveedor en específico.</p>
                    </div>
                    <button type="button" @click="closeManualModal"
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">✕</button>
                </div>

                <div class="space-y-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
                        <select
                            v-model.number="form.proveedorId"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            :disabled="proveedoresLoading"
                        >
                            <option value="">Selecciona proveedor…</option>
                            <option v-for="opt in providerOptions" :key="opt.value" :value="opt.value">
                                {{ opt.label }} · {{ formatMoney(opt.importe) }}
                            </option>
                        </select>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Fecha del cobro</label>
                            <input
                                v-model="form.fechaCobro"
                                type="date"
                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Mes asociado</label>
                            <input
                                v-model="form.mesCobro"
                                type="month"
                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            />
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Concepto</label>
                        <input
                            v-model="form.concepto"
                            type="text"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            placeholder="Ej. Cobro especial"
                        />
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Importe</label>
                        <input
                            v-model.number="form.importe"
                            type="number"
                            min="0"
                            step="0.01"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                        />
                        <p v-if="selectedProvider" class="mt-1 text-xs text-gray-500">
                            Importe sugerido del proveedor: {{ formatMoney(selectedProvider.importe) }}
                        </p>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Nota (opcional)</label>
                        <textarea
                            v-model="form.nota"
                            rows="2"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            placeholder="Observaciones adicionales"
                        ></textarea>
                    </div>
                </div>

                <div v-if="formError" class="rounded border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                    {{ formError }}
                </div>

                <div class="flex gap-2 justify-end">
                    <button type="button" @click="closeManualModal" :disabled="saving"
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
                        Cancelar
                    </button>
                    <button type="button" @click="submitCobro" :disabled="saving"
                        class="inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 text-sm disabled:opacity-60">
                        {{ saving ? 'Guardando…' : 'Crear cobro' }}
                    </button>
                </div>
            </div>
        </div>

        <div v-if="paymentModalOpen && selectedCobro" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" @click.self="closePaymentModal">
            <div class="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h2 class="text-lg font-semibold text-gray-900">Registrar pago</h2>
                        <p class="text-xs text-gray-500 mt-1">
                            {{ selectedCobro.proveedor_id }} ·{{ selectedCobro.proveedor_nombre }} · {{ formatMonth(selectedCobro.mes_cobro) }} · {{ formatMoney(selectedCobro.importe) }}
                        </p>
                    </div>
                    <button type="button" @click="closePaymentModal"
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">✕</button>
                </div>

                <div class="space-y-3 text-sm">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Método de pago</label>
                            <select
                                v-model="paymentForm.metodo"
                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            >
                                <option value="efectivo">Efectivo</option>
                                <option value="transferencia">Transferencia</option>
                                <option value="tarjeta">Tarjeta</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-600 mb-1">Fecha de pago</label>
                            <input
                                v-model="paymentForm.fechaPago"
                                type="date"
                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            />
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Monto recibido</label>
                        <input
                            v-model.number="paymentForm.monto"
                            type="number"
                            min="0"
                            step="0.01"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                        />
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">Nota (opcional)</label>
                        <textarea
                            v-model="paymentForm.nota"
                            rows="2"
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                            placeholder="Detalles adicionales del pago"
                        ></textarea>
                    </div>
                    <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" v-model="paymentForm.enviarTicket" class="rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
                        Enviar comprobante por correo al proveedor
                    </label>
                    <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" v-model="paymentForm.imprimirRecibo" class="rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
                        Imprimir recibo al terminar
                    </label>
                </div>

                <div v-if="paymentError" class="rounded border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                    {{ paymentError }}
                </div>

                <div class="flex gap-2 justify-end">
                    <button type="button" @click="closePaymentModal" :disabled="paymentSaving"
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
                        Cancelar
                    </button>
                    <button type="button" @click="submitPayment" :disabled="paymentSaving"
                        class="inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 text-sm disabled:opacity-60">
                        {{ paymentSaving ? 'Registrando…' : 'Registrar pago' }}
                    </button>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
