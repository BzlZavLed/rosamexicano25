<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import { listMailerEntries, type MailerEntry } from '../api/mailer';

const PER_PAGE = 20;

const loading = ref(false);
const error = ref('');
const search = ref('');
const mailers = ref<MailerEntry[]>([]);
const pagination = reactive({
    page: 1,
    perPage: PER_PAGE,
    total: 0,
    lastPage: 1,
});

let searchTimer: number | undefined;

const pageInfo = computed(() => {
    if (!pagination.total) return null;
    const start = (pagination.page - 1) * pagination.perPage + 1;
    const end = Math.min(start + pagination.perPage - 1, pagination.total);
    return { start, end };
});

const hasResults = computed(() => mailers.value.length > 0);
const canPrev = computed(() => pagination.page > 1);
const canNext = computed(() => pagination.page < pagination.lastPage);

function statusLabel(status: number) {
    if (status === 1) return 'Enviado';
    if (status === 0) return 'Pendiente';
    return `Estado ${status}`;
}

function statusBadgeClass(status: number) {
    if (status === 1) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (status === 0) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
}

function formatFecha(fecha: string) {
    if (!fecha) return '—';
    const trimmed = fecha.trim();
    if (!trimmed) return '—';

    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
    let normalized = trimmed.replace(' ', 'T');

    if (DATE_ONLY.test(trimmed)) {
        normalized = `${trimmed}T00:00:00`;
    } else if (!normalized.includes('T')) {
        normalized = `${normalized}T00:00:00`;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return fecha;

    const hasTime = /[T]\d{2}:\d{2}/.test(normalized) && !/T00:00:00$/.test(normalized);
    return parsed.toLocaleString('es-MX', hasTime
        ? { dateStyle: 'medium', timeStyle: 'short' }
        : { dateStyle: 'medium' });
}

function isValidMailUrl(mail?: string | null) {
    if (!mail) return false;
    const trimmed = mail.trim();
    if (!trimmed || trimmed.toLowerCase() === 'cobro-sin-comprobante') return false;
    try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function scheduleFetch() {
    if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = undefined;
    }
    searchTimer = window.setTimeout(loadMailers, 350);
}

async function loadMailers() {
    loading.value = true;
    error.value = '';
    try {
        const params: Record<string, any> = {
            page: pagination.page,
            per_page: pagination.perPage,
            sort: 'fecha_desc',
        };
        if (search.value.trim()) params.search = search.value.trim();

        const resp = await listMailerEntries(params);
        const rows = Array.isArray((resp as any)?.data)
            ? (resp as any).data
            : Array.isArray(resp)
                ? resp
                : [];

        mailers.value = [...rows].sort((a, b) => {
            const da = new Date(a.fecha).getTime();
            const db = new Date(b.fecha).getTime();
            return Number.isNaN(db - da) ? 0 : db - da;
        });

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
        error.value = e?.response?.data?.message || 'No se pudo cargar el historial de emails';
        mailers.value = [];
        pagination.total = 0;
        pagination.lastPage = 1;
    } finally {
        loading.value = false;
    }
}

function goToPage(page: number) {
    if (page < 1 || page > pagination.lastPage || page === pagination.page) return;
    pagination.page = page;
}

function openLink(url: string) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}

watch(search, () => {
    pagination.page = 1;
    scheduleFetch();
});

watch(() => pagination.page, (newVal, oldVal) => {
    if (oldVal === undefined || newVal === oldVal) return;
    loadMailers();
});

onMounted(() => {
    loadMailers();
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
            <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="text-xl font-semibold text-gray-900">Historial de emails</h1>
                    <p class="text-sm text-gray-500">Consulta los comprobantes enviados por correo y descarga el PDF asociado.</p>
                </div>
                <div class="flex items-center gap-2">
                    <input
                        v-model="search"
                        type="search"
                        placeholder="Filtrar por correo, asunto o mensaje…"
                        class="w-full sm:w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
                    />
                </div>
            </header>

            <section class="bg-white border border-gray-200 rounded-xl shadow-sm">
                <div class="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                    <div class="text-sm text-gray-600">
                        <span v-if="loading">Cargando historial…</span>
                        <span v-else-if="pageInfo">Mostrando {{ pageInfo.start }} - {{ pageInfo.end }} de {{ pagination.total }}</span>
                        <span v-else>Sin registros</span>
                    </div>
                    <div class="flex items-center gap-2 text-sm">
                        <button
                            type="button"
                            class="inline-flex items-center rounded-lg border border-gray-300 px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                            :disabled="loading || !canPrev"
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
                            :disabled="loading || !canNext"
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
                                <th class="px-4 py-3 text-left font-medium">ID</th>
                                <th class="px-4 py-3 text-left font-medium">Archivo</th>
                                <th class="px-4 py-3 text-left font-medium">Asunto</th>
                                <th class="px-4 py-3 text-left font-medium">Mensaje</th>
                                <th class="px-4 py-3 text-left font-medium">Estado</th>
                                <th class="px-4 py-3 text-left font-medium">Fecha</th>
                                <th class="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            <tr v-if="error">
                                <td colspan="7" class="px-4 py-6 text-center text-rose-600">{{ error }}</td>
                            </tr>
                            <tr v-else-if="!loading && !hasResults">
                                <td colspan="7" class="px-4 py-6 text-center text-gray-500">No hay coincidencias para la búsqueda.</td>
                            </tr>
                            <tr
                                v-for="item in mailers"
                                :key="item.id"
                                :class="[
                                    'hover:bg-gray-50',
                                    !isValidMailUrl(item.mail) ? 'bg-amber-50/60' : ''
                                ]"
                            >
                                <td class="px-4 py-3 font-mono text-xs text-gray-500">#{{ item.id }}</td>
                                <td class="px-4 py-3">
                                    <template v-if="isValidMailUrl(item.mail)">
                                        <button
                                            type="button"
                                            class="inline-flex items-center gap-1 text-sm text-gray-700 underline underline-offset-4 hover:text-gray-900"
                                            @click="openLink(item.mail)"
                                        >
                                            Ver PDF
                                        </button>
                                    </template>
                                    <span v-else class="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                        Sin PDF almacenado
                                    </span>
                                </td>
                                <td class="px-4 py-3 font-medium text-gray-800">
                                    <div class="max-w-xs truncate" :title="item.asunto">{{ item.asunto }}</div>
                                </td>
                                <td class="px-4 py-3">
                                    <div class="max-w-sm truncate" :title="item.mensaje">{{ item.mensaje }}</div>
                                </td>
                                <td class="px-4 py-3">
                                    <span
                                        class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
                                        :class="statusBadgeClass(Number(item.status))"
                                    >
                                        {{ statusLabel(Number(item.status)) }}
                                    </span>
                                </td>
                                <td class="px-4 py-3 text-sm text-gray-600">
                                    {{ formatFecha(item.fecha) }}
                                </td>
                                <td class="px-4 py-3 text-right">
                                    <template v-if="isValidMailUrl(item.mail)">
                                        <button
                                            type="button"
                                            class="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-800"
                                            @click="openLink(item.mail)"
                                        >
                                            Abrir
                                            <span aria-hidden="true">↗</span>
                                        </button>
                                    </template>
                                    <span v-else class="text-xs text-amber-600 uppercase tracking-wide">Sin archivo</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    </AppLayout>
</template>
