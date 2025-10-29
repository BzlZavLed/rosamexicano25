<!-- src/pages/AdminDashboard.vue -->
<script setup lang="ts">
import AppLayout from '../components/layout/AppLayout.vue'
import MailerQuotaWidget from '../components/widgets/MailerQuotaWidget.vue'
</script>

<template>
    <AppLayout>
        <div class="p-6 space-y-4">
            <div class="flex items-center justify-between">
                <h1 class="text-xl font-semibold">Admin Dashboard</h1>
            </div>
            <p>Desde aquí podrás acceder a Proveedores, Productos, Inventario, Caja y Ventas.</p>

            <!-- Widgets row -->
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                <MailerQuotaWidget />
                <!-- Add more widgets here as you build them -->
            </div>
        </div>
    </AppLayout>
</template>
