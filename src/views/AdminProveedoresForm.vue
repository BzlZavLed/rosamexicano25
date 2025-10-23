<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue';
import AppLayout from '../components/layout/AppLayout.vue';
import {
    listProveedores, createProveedor, updateProveedor, deleteProveedor, type Proveedor
} from '../api/proveedores';

const loading = ref(false);
const saving = ref(false);
const message = ref('');
const error = ref('');

const q = ref('');
const proveedores = ref<Proveedor[]>([]);
const selectedId = ref<number | null>(null);

type FormT = {
    id?: number | null;
    ident: number | null;
    nombre: string;
    tel: string;
    email: string;
    fecha: string;        // YYYY-MM-DD
    ciudad: string;
    bancaria: string;     // cuenta
    sucursal: string;     // banco
    importe: number | null; // cobro mensual
};
const form = reactive<FormT>({
    id: null,
    ident: null,
    nombre: '',
    tel: '',
    email: '',
    fecha: new Date().toISOString().slice(0, 10),
    ciudad: '',
    bancaria: '',
    sucursal: '',
    importe: null,
});

function randIdent(): number { return Math.floor(100000 + Math.random() * 900000); }

function resetForm() {
    form.id = null;
    form.ident = randIdent();
    form.nombre = '';
    form.tel = '';
    form.email = '';
    form.fecha = new Date().toISOString().slice(0, 10);
    form.ciudad = '';
    form.bancaria = '';
    form.sucursal = '';
    form.importe = null;
    selectedId.value = null;
    message.value = '';
    error.value = '';
}

async function loadList() {
    loading.value = true;
    try {
        const data = await listProveedores(q.value ? { search: q.value, page: 1, per_page: 20 } : undefined);
        proveedores.value = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error listando proveedores';
    } finally {
        loading.value = false;
    }
}

async function selectRow(row: Proveedor) {
    selectedId.value = row.id;
    form.id = row.id;
    form.ident = row.ident;
    form.nombre = row.nombre || '';
    form.tel = row.tel || '';
    form.email = row.email || '';
    form.fecha = row.fecha || new Date().toISOString().slice(0, 10);
    form.ciudad = row.ciudad || '';
    form.bancaria = row.bancaria || '';
    form.sucursal = row.sucursal || '';   // banco
    form.importe = (row.importe as any) != null ? Number(row.importe) : null;
    message.value = ''; error.value = '';
}

async function submitCreateOrUpdate() {
    error.value = ''; message.value = '';
    if (!form.ident) form.ident = randIdent();
    if (!form.nombre) { error.value = 'El nombre es obligatorio'; return; }
    let payload = {};
    saving.value = true;
    try {
        let saved: Proveedor;
        payload = {
            ident: form.ident!,
            nombre: form.nombre,
            tel: form.tel || null,
            email: form.email || null,
            fecha: form.fecha || null,
            ciudad: form.ciudad || null,
            bancaria: form.bancaria || null,
            sucursal: form.sucursal || null,
            importe: form.importe != null ? Number(form.importe) : null,
        };

        if (form.id) {
            saved = await updateProveedor(form.id, payload);
            message.value = 'Proveedor actualizado';
        } else {
            saved = await createProveedor(payload);
            message.value = 'Proveedor creado';
            form.id = saved.id; selectedId.value = saved.id;
        }
        await loadList();
        resetForm();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'Error guardando proveedor';
    } finally {
        saving.value = false;
    }
}

async function removeProveedor() {
    if (!form.id) return;
    if (!confirm('¿Eliminar proveedor?')) return;
    saving.value = true; error.value = ''; message.value = '';
    try {
        await deleteProveedor(form.id);
        message.value = 'Proveedor eliminado';
        resetForm();
        await loadList();
    } catch (e: any) {
        error.value = e?.response?.data?.message || 'No se pudo eliminar';
    } finally {
        saving.value = false;
    }
}

watch(q, () => loadList());

onMounted(async () => {
    resetForm();
    await loadList();
});
</script>

<template>
    <AppLayout>
        <div class="bg-white border border-gray-200 rounded-xl shadow p-6">
            <h2 class="text-2xl font-semibold mb-6">Dar de alta proveedores</h2>

            <!-- Alerts -->
            <div v-if="message"
                class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-2 text-sm">
                {{ message }}
            </div>
            <div v-if="error" class="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm">
                {{ error }}
            </div>

            <!-- ===== FORM ===== -->
            <div class="space-y-5">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">#Identificador</label>
                        <div class="flex gap-2">
                            <input v-model.number="form.ident" type="number" inputmode="numeric"
                                class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                                placeholder="IDENTIFICADOR" />
                            <button type="button" @click="form.ident = randIdent()"
                                class="shrink-0 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Generar</button>
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Tel contacto</label>
                        <input v-model="form.tel" type="tel"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de alta</label>
                        <input v-model="form.fecha" type="date"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                    </div>

                    <div class="lg:col-span-1 md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                        <input v-model="form.nombre" type="text"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Nombre del proveedor" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Email proveedor</label>
                        <input v-model="form.email" type="email"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="email@proveedor.com" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Cobro mensual</label>
                        <input v-model.number="form.importe" type="number" min="0" step="0.01"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="MENSUALIDAD" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Ciudad/Municipio</label>
                        <input v-model="form.ciudad" type="text"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Ciudad" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Cuenta bancaria</label>
                        <input v-model="form.bancaria" type="text"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="# Cuenta" />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Banco</label>
                        <input v-model="form.sucursal" type="text"
                            class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2"
                            placeholder="Banco" />
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex flex-wrap gap-2">
                    <button :disabled="saving" @click="submitCreateOrUpdate"
                        class="rounded-lg bg-[#E4007C] hover:bg-[#cc006f] text-white px-4 py-2 text-sm disabled:opacity-60">
                        {{ form.id ? 'Actualizar proveedor' : 'Crear proveedor' }}
                    </button>
                    <button :disabled="!form.id || saving" @click="removeProveedor"
                        class="rounded-lg bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 text-sm disabled:opacity-60">
                        Eliminar proveedor
                    </button>
                    
                </div>
            </div>

            <!-- ===== SEARCH / TABLE ===== -->
            <div class="mt-10">
                <div class="mb-3">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Consulta proveedores</label>
                    <input v-model="q" type="text" placeholder="Nombre, email, teléfono, ciudad…"
                        class="w-full rounded-lg border-gray-300 focus:border-gray-900 focus:ring-gray-900 px-3 py-2" />
                </div>

                <div class="max-h-96 overflow-auto border border-gray-200 rounded-lg">
                    <table class="min-w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500">
                            <tr>
                                <th class="text-left font-medium px-3 py-2">ID</th>
                                <th class="text-left font-medium px-3 py-2">Ident</th>
                                <th class="text-left font-medium px-3 py-2">Nombre</th>
                                <th class="text-left font-medium px-3 py-2">Tel</th>
                                <th class="text-left font-medium px-3 py-2">Email</th>
                                <th class="text-left font-medium px-3 py-2">Ciudad</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in proveedores" :key="p.id" @click="selectRow(p)"
                                :class="['cursor-pointer hover:bg-gray-50', selectedId === p.id ? 'bg-gray-100' : '']">
                                <td class="px-3 py-2">{{ p.id }}</td>
                                <td class="px-3 py-2">{{ p.ident }}</td>
                                <td class="px-3 py-2">{{ p.nombre }}</td>
                                <td class="px-3 py-2">{{ p.tel }}</td>
                                <td class="px-3 py-2">{{ p.email }}</td>
                                <td class="px-3 py-2">{{ p.ciudad }}</td>
                            </tr>
                            <tr v-if="!loading && proveedores.length === 0">
                                <td colspan="6" class="px-3 py-3 text-center text-gray-500">Sin resultados</td>
                            </tr>
                            <tr v-if="loading">
                                <td colspan="6" class="px-3 py-3 text-center text-gray-500">Cargando…</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
