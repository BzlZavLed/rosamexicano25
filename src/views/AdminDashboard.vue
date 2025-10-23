<!-- src/views/AdminDashboard.vue -->
<AppNav />
<script setup lang="ts">
import AppLayout from '../components/layout/AppLayout.vue';

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
