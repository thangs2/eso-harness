import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

export interface KnowledgeCheck {
    id: string;
    label: string;
    status: 'PASS' | 'FAIL' | 'INFO';
    detail: string;
}

export class KnowledgeCheckService {
    constructor(private readonly store: PlatformStore) {}

    async check(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const [summary, findings, coverage] = await Promise.all([
            this.store.knowledgeSummary(id),
            this.store.knowledgeFindings(id, 200),
            this.store.knowledgeCoverage(id),
        ]);
        const codes = new Set(findings.map((finding: any) => finding.code));
        const checks: KnowledgeCheck[] = [
            {
                id: 'KM-01',
                label: 'Documents indexed',
                status: summary.docs > 0 ? 'PASS' : 'FAIL',
                detail: `${summary.docs} docs`,
            },
            {
                id: 'KM-02',
                label: 'Manifest generated',
                status: summary.manifest ? 'PASS' : 'FAIL',
                detail: summary.manifest ? `manifest v${summary.manifest.manifest_version} · ${summary.manifest.build_id}` : 'no manifest',
            },
            {
                id: 'KM-03',
                label: 'No unresolved links',
                status: codes.has('UNRESOLVED_LINK') ? 'FAIL' : 'PASS',
                detail: findings.filter((finding: any) => finding.code === 'UNRESOLVED_LINK').length + ' unresolved',
            },
            {
                id: 'KM-04',
                label: 'No missing anchors',
                status: codes.has('ANCHOR_MISSING') ? 'FAIL' : 'PASS',
                detail: findings.filter((finding: any) => finding.code === 'ANCHOR_MISSING').length + ' missing anchors',
            },
            {
                id: 'KM-05',
                label: 'Header id present',
                status: codes.has('HEADER_ID_MISSING') ? 'FAIL' : 'PASS',
                detail: findings.filter((finding: any) => finding.code === 'HEADER_ID_MISSING').length + ' docs without id',
            },
            {
                id: 'KM-06',
                label: 'Coverage inventory',
                status: coverage.some((item: any) => item.docs > 0) ? 'PASS' : 'FAIL',
                detail: `${coverage.filter((item: any) => item.docs > 0).length}/${coverage.length} types covered`,
            },
        ];
        return {
            status: checks.every((check) => check.status !== 'FAIL') ? 'PASS' : 'FAIL',
            checks,
            summary,
            coverage,
            findings,
        };
    }
}
