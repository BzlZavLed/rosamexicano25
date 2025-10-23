<!-- src/views/AdminDashboard.vue -->
<AppNav />
<script setup lang="ts">
import AppLayout from '../components/layout/AppLayout.vue';

import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import { logout } from '../api/auth';
const auth = useAuthStore();
const router = useRouter();
async function doLogout() { await logout(); auth.logout(); router.push({ name: 'login' }); }
</script>

<template>
      <AppLayout>
    <div class="p-6 space-y-4">
        <div class="flex items-center justify-between">
            <h1 class="text-xl font-semibold">Admin Dashboard</h1>
        </div>
        <p>Desde aquí podrás acceder a Proveedores, Productos, Inventario, Caja y Ventas.</p>
    </div>
    </AppLayout>
</template>
