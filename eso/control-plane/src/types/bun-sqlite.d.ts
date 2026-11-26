declare module 'bun:sqlite' {
    export class Database {
        constructor(path?: string, options?: any);
        run(sql: string, ...params: any[]): any;
        query(sql: string): {
            all(...params: any[]): any[];
            get(...params: any[]): any;
            run(...params: any[]): any;
        };
        prepare(sql: string): {
            all(...params: any[]): any[];
            get(...params: any[]): any;
            run(...params: any[]): any;
        };
        close(): void;
    }
}
