import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { BoundaryPathType, BoundaryReadMode, BoundaryWriteMode } from '../../../../../../../libs/api-client/types.js';

export type PolicyFormGroup = FormGroup<{
    id: FormControl<string>;
    path: FormControl<string>;
    pathType: FormControl<BoundaryPathType>;
    read: FormControl<BoundaryReadMode>;
    write: FormControl<BoundaryWriteMode>;
    index: FormControl<boolean>;
    priority: FormControl<number>;
    reason: FormControl<string>;
}>;

export type PolicyCategory = 'all' | 'invariants' | 'secrets' | 'data-lake' | 'workspace';

export interface PolicyCategoryOption {
    id: PolicyCategory;
    label: string;
    icon: string;
}

@Component({
    selector: 'eso-boundaries-policy-list',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
    ],
    templateUrl: './boundaries-policy-list.component.html',
    styleUrl: './boundaries-policy-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesPolicyListComponent {
    readonly policyForm = input.required<FormArray<PolicyFormGroup>>();
    readonly categories = input.required<readonly PolicyCategoryOption[]>();
    readonly selectedCategory = input.required<PolicyCategory>();
    readonly matchedPolicyIndex = input<number | null>(null);
    readonly policyCount = input.required<number>();

    readonly categoryChange = output<PolicyCategory>();
    readonly remove = output<number>();
    readonly add = output<void>();

    getCategoryForPolicy(path: string, id: string): PolicyCategory {
        const p = path.toLowerCase();
        const i = id.toLowerCase();
        if (p.includes('.env') || p.includes('credentials') || p.includes('.pem') || p.includes('secret') || i.includes('secret') || i.includes('credentials') || i.includes('pem')) {
            return 'secrets';
        }
        if (p.includes('data-lake') || i.includes('data-lake')) {
            return 'data-lake';
        }
        if (p.startsWith('.git') || p.includes('config.json') || p.includes('manifest.json') || p === 'agents.md' || p === 'agents/hooks/**' || p.includes('agents/hooks') || i.includes('invariants') || i.includes('harness-config') || i.includes('harness-manifest') || i.includes('agents-md') || i.includes('hooks') || i.includes('git')) {
            return 'invariants';
        }
        return 'workspace';
    }

    isPolicyVisible(policy: PolicyFormGroup): boolean {
        const cat = this.selectedCategory();
        if (cat === 'all') return true;
        const path = policy.controls.path.value || '';
        const id = policy.controls.id.value || '';
        return this.getCategoryForPolicy(path, id) === cat;
    }

    categoryCount(cat: PolicyCategory): number {
        if (cat === 'all') return this.policyForm().length;
        let count = 0;
        for (const ctrl of this.policyForm().controls) {
            const path = ctrl.controls.path.value || '';
            const id = ctrl.controls.id.value || '';
            if (this.getCategoryForPolicy(path, id) === cat) count++;
        }
        return count;
    }
}
