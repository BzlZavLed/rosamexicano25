import http from './http';

export type CobroStatus = 'pending' | 'paid' | 'overdue';

export type Cobro = {
    id: number;
    proveedor_id: number;
    proveedor_nombre: string;
    importe: number;
    fecha_cobro: string;
    mes_cobro: string;
    status: CobroStatus;
    pago_metodo?: string | null;
    pago_fecha?: string | null;
    concepto?: string | null;
    nota?: string | null;
    cobro_pdf_url?: string | null;
    created_at?: string;
    updated_at?: string;
};

type CobroListParams = {
    search?: string;
    page?: number;
    per_page?: number;
    status?: CobroStatus | 'all';
};

export async function listCobros(params?: CobroListParams) {
    const { data } = await http.get('/mensualidad', { params });
    return data as {
        data?: Cobro[];
        meta?: {
            total?: number;
            current_page?: number;
            per_page?: number;
            last_page?: number;
        };
        total?: number;
        current_page?: number;
        per_page?: number;
        last_page?: number;
    } | Cobro[];
}

export async function createCobro(payload: {
    proveedor_id: number;
    fecha_cobro: string;
    mes_cobro: string;
    importe: number;
    concepto?: string | null;
    nota?: string | null;
    cobro_pdf_base64?: string;
}) {
    const { data } = await http.post('/mensualidad', payload);
    return data;
}

export async function payCobro(id: number, payload: {
    metodo: string;
    monto: number;
    fecha_pago: string;
    nota?: string | null;
    enviar_ticket?: boolean;
    proveedor_id: number;
    receipt_pdf_base64?: string;
}) {
    const { data } = await http.post(`/mensualidad/${id}/pay`, payload);
    return data;
}

export async function bulkCreateMensualidad(payload: {
    mes_cobro: string;
    fecha_cobro: string;
    concepto: string;
    cobro_pdf_base64?: string;
    cobros?: Array<{ proveedor_id: number; importe: number; cobro_pdf_base64: string }>;
}) {
    const { data } = await http.post('/mensualidad/bulk', payload);
    return data;
}
