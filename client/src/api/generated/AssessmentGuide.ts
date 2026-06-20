// Types for the CMMC Level 2 Assessment Guide data that accompanies the
// NIST SP 800-171 Rev. 2 framework. This content is assessor-oriented guidance
// (how an assessor determines a requirement is met) and only exists for Rev. 2.

export interface AssessmentMethods {
    /** Documents, records, or mechanisms an assessor reviews. */
    examine: string[];
    /** Roles an assessor interviews. */
    interview: string[];
    /** Processes or mechanisms an assessor exercises. */
    test: string[];
}

export interface AssessmentGuideRequirement {
    /** CMMC identifier, e.g. "AC.L2-3.1.1". */
    id: string;
    /** NIST SP 800-171 Rev. 2 control number, e.g. "3.1.1". */
    nist_sp_800_171: string;
    /** Framework element identifier, e.g. "03.01.01". Used to join to requirements. */
    export_id: string;
    name: string;
    cui_data: boolean;
    statement: string;
    /** Determination statements keyed by objective letter ("a", "b", ...). */
    assessment_objectives: Record<string, string>;
    assessment_methods: AssessmentMethods;
    discussion: string;
    further_discussion: string;
    key_references: string[];
}

export interface AssessmentGuide {
    source: string;
    requirement_count: number;
    objective_count: number;
    requirements: AssessmentGuideRequirement[];
}
