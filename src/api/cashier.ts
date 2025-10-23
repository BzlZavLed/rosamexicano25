// src/api/cashier.ts
import http from './http'; // your axios instance with baseURL + auth

export type CashMethod = 'efectivo' | 'debit' | 'credit';

export type CashierFindParams = {
    barcode?: number | string;
    search?: string;
    proveedor_id?: number;
    per_page?: number;
};

export async function cajaStatus() {
    const { data } = await http.get('/caja/status');
    return data as { open: boolean; caja: any };
}

export async function cajaOpen(payload: { saldoinicial: number; fecha?: string }) {
    const { data } = await http.post('/caja/open', payload);
    return data;
}

export async function cajaClose(payload?: { saldofinal?: number; fecha?: string }) {
    const { data } = await http.post('/caja/close', payload ?? {});
    return data;
}

export async function findProduct(params: CashierFindParams) {
    const { data } = await http.get('/cashier/find-product', { params });
    // API returns { data: Producto[] }
    return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
}

export async function checkout(payload: {
    items: Array<{ ident: number; qty: number }>;
    discount_percent?: number;
    payment: { method: CashMethod; received?: number };
    ie: number;
}) {
    const { data } = await http.post('/cashier/checkout', payload);
    return data; // { data: {...} }
}

export type CashMovementPayload = {
    totalventa: number;
    metodo: CashMethod;
    recibo?: number;
    cambio?: number;
    vendedor?: string;
    fecha: string;
    ie: 0 | 1;
    concepto: string;
};

export async function registerExpense(payload: CashMovementPayload) {
    const { data } = await http.post('/cashier/expenses', payload);
    return data;
}
