// src/router/index.ts
import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { useAuthStore } from "../stores/auth";

const LoginView = () => import("../views/LoginView.vue");
const AdminDashboard = () => import("../views/AdminDashboard.vue");
const ProviderDashboard = () => import("../views/ProvidersDashboard.vue");
const AdminProductosForm = () => import("../views/AdminProductosForm.vue");
const AdminProveedoresForm = () => import("../views/AdminProveedoresForm.vue");
const AdminInventarioEntrada = () => import("../views/AdminInventarioEntrada.vue");
const AdminPromociones = () => import("../views/AdminPromociones.vue");
const AdminCajaView = () => import("../views/AdminCajaView.vue");


const routes: RouteRecordRaw[] = [
    { path: "/", redirect: "/login" },
    {
        path: "/login",
        name: "login",
        component: LoginView,
        meta: { public: true },
    },

    // Admin-only area
    {
        path: "/dashboard",
        name: "admin-dashboard",
        component: AdminDashboard,
        meta: { requiresAuth: true, role: "admin" },
    },

    // Provider-only area
    {
        path: "/provider",
        name: "provider-dashboard",
        component: ProviderDashboard,
        meta: { requiresAuth: true, role: "provider" },
    },

    // 404
    { path: "/:pathMatch(.*)*", redirect: "/login" },

    //Productos crear
    {
        path: "/admin/productos/crear",
        name: "admin-productos-form",
        component: AdminProductosForm,
        meta: { requiresAuth: true, role: "admin" },
    },
    //Proveedores crear
    {
        path: '/admin/proveedores',
        name: 'admin-proveedores-form',
        component: AdminProveedoresForm,
        meta: { requiresAuth: true, role: 'admin' }
    },
    //Inventory crear
    {
        path: '/admin/inventario/entrada',
        name: 'admin-inventario-entrada',
        component: AdminInventarioEntrada,
        meta: { requiresAuth: true, role: 'admin' }
    },
    //Promociones crear
    {
        path: '/admin/promociones',
        name: 'admin-promociones',
        component: AdminPromociones,
        meta: { requiresAuth: true, role: 'admin' }
    },
    //Caja view
    {
        path: '/admin/caja',
        name: 'admin-caja',
        component: AdminCajaView,
        meta: { requiresAuth: true, role: 'admin' }
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach(async (to) => {
    const auth = useAuthStore();

    if (!auth.isAuthenticated && !to.meta.public) {
        const ok = await auth.hydrateFromToken();
        if (!ok) return { name: "login" };
    }

    if (to.meta.requiresAuth) {
        const requiredRole = to.meta.role as "admin" | "provider" | undefined;
        if (requiredRole && auth.role !== requiredRole) {
            return auth.isAdmin
                ? { name: "admin-dashboard" }
                : { name: "provider-dashboard" };
        }
    }
});

export default router;
