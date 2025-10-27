import http from './http';

export type MailerEntry = {
    id: number;
    mail: string;
    asunto: string;
    mensaje: string;
    status: number;
    fecha: string;
};

type ListParams = {
    search?: string;
    page?: number;
    per_page?: number;
    sort?: string;
};

export async function listMailerEntries(params?: ListParams) {
    const { data } = await http.get('/mailer', { params });
    return data as {
        data?: MailerEntry[];
        meta?: {
            current_page?: number;
            per_page?: number;
            total?: number;
            last_page?: number;
        };
        total?: number;
        current_page?: number;
        per_page?: number;
        last_page?: number;
    } | MailerEntry[];
}
