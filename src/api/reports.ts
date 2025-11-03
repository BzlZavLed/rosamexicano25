import http from './http';

export type CajaReportLine = {
    idprod: number;
    nombre: string;
    proveedor: number;
    puni: number;
    cant: number;
    total: number;
    product_desc?: number;
    descuento_producto?: number;
    promotion?: string;
};

export type CajaReportVenta = {
    idventa: number;
    fecha: string;
    metodo: string;
    subtotal: number;
    descuento_general?: number;
    descuento_general_percent?: number;
    descuento_general_amount?: number;
    tarjeta_cargo: number;
    descuento_lineas?: number;
    descuento_total?: number;
    totalventa: number;
    ie: number;
    concepto: string;
    recibo: number;
    cambio: number;
    vendedor: string;
    lineas: CajaReportLine[];
};

export type CajaReportResponse = {
    from_date: string;
    to_date: string;
    ventas: CajaReportVenta[];
};

type CajaReportParams = {
    from_date: string;
    to_date: string;
    download?: boolean;
};

export async function getCajaReport(params: CajaReportParams) {
    const { from_date, to_date, download } = params;
    const query: Record<string, any> = { from_date, to_date };
    if (download) query.download = 1;

    if (download) {
        const { data } = await http.get('/reports/caja', {
            params: query,
            responseType: 'blob',
        });
        return data as Blob;
    }

    const { data } = await http.get<CajaReportResponse>('/reports/caja', { params: query });
    return data;
}

// ---------------------
// REPORT PRODUCTOS
// ---------------------

export interface Proveedor {
    ident: string;
    nombre: string;
}

export interface ProductoRow {
    id: number;
    ident: string;
    nombre: string;
    precio: number | null;
    proveedor: Proveedor | null;
}

export interface ProductosPagination {
    total: number;
    count: number;
    per_page: number;
    current_page: number;
    last_page: number;
    next_page_url: string | null;
    prev_page_url: string | null;
}

export interface ProductosReportResponse {
    data: ProductoRow[];
    pagination: ProductosPagination;
}

// ---------------------
// REPORT INVENTARIO
// ---------------------

export interface InventarioRow {
    inventario_id: number;
    producto_ident: string;
    producto_nombre: string;
    precio: number | null;
    existencia: number;
    costo_inventario: number;
    proveedor: Proveedor | null;
}

export interface InventarioReportResponse {
    data: InventarioRow[];
    pagination: ProductosPagination;
}

// --- Productos API call (standardized to `http`) ---
export async function getProductosReport(opts: {
    q?: string;
    page?: number;
    per_page?: number;
} = {}): Promise<ProductosReportResponse> {
    const params: Record<string, string | number> = {};
    if (opts.q) params.q = opts.q;
    if (opts.page) params.page = opts.page;
    if (opts.per_page) params.per_page = opts.per_page;

    // Match the same style as getCajaReport (baseURL handles /api)
    const { data } = await http.get<ProductosReportResponse>('/reports/productos', { params });
    return data;
}

export async function getInventarioReport(opts: {
    q?: string;
    page?: number;
    per_page?: number;
    sort?: 'producto' | 'existencia' | 'proveedor';
    direction?: 'asc' | 'desc';
} = {}): Promise<InventarioReportResponse> {
    const params: Record<string, string | number> = {};
    if (opts.q) params.q = opts.q;
    if (opts.page) params.page = opts.page;
    if (opts.per_page) params.per_page = opts.per_page;
    if (opts.sort) params.sort = opts.sort;
    if (opts.direction) params.direction = opts.direction;

    const { data } = await http.get<InventarioReportResponse>('/reports/inventario', { params });
    return data;
}
