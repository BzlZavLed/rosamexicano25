<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '../../stores/auth';
import SidebarAdmin from './SidebarAdmin.vue';
import SidebarProvider from './SidebarProvider.vue';

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);
const isProvider = computed(() => auth.isProvider);
const drawerOpen = ref(false);

function toggle() { drawerOpen.value = !drawerOpen.value; }
async function logout() { await auth.logout(); window.location.href = '/login'; }
</script>

<template>
    <div class="min-h-screen bg-gray-50 text-gray-900">
        <!-- Header -->
        <header class="sticky top-0 z-40 w-full bg-white border-b border-gray-200">
            <div class="mx-auto max-w-7xl h-14 px-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <button
                        class="md:hidden inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        @click="toggle" aria-label="Abrir menú">☰</button>
                    <div class="font-semibold">Rosa Mexicano POS</div>
                </div>
                <div class="flex items-center gap-3 text-sm text-gray-600">
                    <span>
                        {{ auth.displayName }}
                        <span v-if="isAdmin" class="ml-1 text-xs text-gray-400">(admin)</span>
                        <span v-else-if="isProvider" class="ml-1 text-xs text-gray-400">(proveedor)</span>
                    </span>
                    <button
                        class="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        @click="logout">Salir</button>
                </div>
            </div>
        </header>

        <!-- Body -->
        <div class="mx-auto max-w-7xl px-4">
            <div class="flex">
                <!-- Desktop sidebar -->
                <aside class="hidden md:block shrink-0 w-[260px] pt-4">
                    <component :is="isAdmin ? SidebarAdmin : SidebarProvider" />
                </aside>

                <!-- Mobile drawer -->
                <transition name="fade">
                    <div v-if="drawerOpen" class="fixed inset-0 z-40 bg-black/30 md:hidden" @click="drawerOpen = false">
                    </div>
                </transition>
                <transition name="slide">
                    <aside v-if="drawerOpen"
                        class="fixed left-0 top-0 z-50 h-full w-[82vw] max-w-xs bg-white border-r border-gray-200 p-3 md:hidden">
                        <div class="flex items-center justify-between mb-2">
                            <div class="font-semibold">Módulos</div>
                            <button
                                class="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                                @click="drawerOpen = false">✕</button>
                        </div>
                        <component :is="isAdmin ? SidebarAdmin : SidebarProvider" @navigate="drawerOpen = false" />
                    </aside>
                </transition>

                <!-- Main content -->
                <main class="flex-1 md:pl-6 py-6">
                    <slot />
                </main>
            </div>
        </div>
    </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity .15s ease
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0
}

.slide-enter-active,
.slide-leave-active {
    transition: transform .2s ease
}

.slide-enter-from {
    transform: translateX(-100%)
}

.slide-leave-to {
    transform: translateX(-100%)
}
</style>
