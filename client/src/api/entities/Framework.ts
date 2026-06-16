import {
    Convert,
    Element,
    ElementType,
    Framework,
} from "@/api/generated/Framework";
import dataV2 from "../../../public/data/sp_800_171_2_0_0/framework.json";
import dataV3 from "../../../public/data/sp_800_171_3_0_0/framework.json";

export const frameworkV2: Framework = Object.freeze(
    Convert.toFrameworkDict(dataV2),
);
export const frameworkV3: Framework = Object.freeze(
    Convert.toFrameworkDict(dataV3),
);

export const getFamily = (element: Element) => {
    switch (element.element_type) {
        case "requirement":
            return element.element_identifier.slice(0, 5);
        case "security_requirement":
            return element.element_identifier.slice(3, 8);
        case "discussion":
            return element.element_identifier.slice(2, 7);
        case "family":
        default:
            return element.element_identifier;
    }
};
export const getRequirement = (element: Element) => {
    switch (element.element_type) {
        case "requirement":
            return element.element_identifier;
        case "security_requirement":
            return element.element_identifier.slice(3, 11);
        case "discussion":
            return element.element_identifier.slice(2);
        case "withdraw_reason":
            return element.element_identifier.slice(3);
        default:
            return element.element_identifier;
    }
};

export const getSubRequirement = (element: Element) => {
    switch (element.element_type) {
        case "security_requirement":
            return element.element_identifier.slice(3, 13);
        default:
            return element.element_identifier;
    }
};

export const getSubSubRequirement = (element: Element) => {
    switch (element.element_type) {
        case "security_requirement":
            return element.element_identifier.slice(3);
        default:
            return element.element_identifier;
    }
};

export class ElementWrapper {
    readonly element: Element;

    constructor(element: Element) {
        this.element = element;
        Object.freeze(this);
    }

    get element_identifier() {
        return this.element.element_identifier;
    }

    get element_type() {
        return this.element.element_type;
    }

    get id() {
        return this.element_identifier;
    }

    get title() {
        return this.element.title;
    }

    get text() {
        return this.element.text;
    }

    get type() {
        return this.element_type;
    }

    get doc_identifier() {
        return this.element.doc_identifier;
    }

    get family() {
        return getFamily(this.element);
    }

    get requirement() {
        return getRequirement(this.element);
    }

    get subRequirement() {
        return getSubRequirement(this.element);
    }

    get subSubRequirement() {
        return getSubSubRequirement(this.element);
    }

    static fromElement(element: Element) {
        return new ElementWrapper(element);
    }
}

export class ElementMapper {
    readonly elements: ElementWrapper[];
    readonly byId: Record<string, ElementWrapper> = {};
    readonly byFamily: Record<string, ElementWrapper[]> = {};
    readonly byRequirements: Record<string, ElementWrapper[]> = {};
    readonly bySubRequirements: Record<string, ElementWrapper[]> = {};
    readonly bySubSubRequirements: Record<string, ElementWrapper[]> = {};
    readonly byWithdrawnReason: Record<string, ElementWrapper[]> = {};

    constructor(elements: ElementWrapper[]) {
        this.elements = elements;
        for (const element of this.elements) {
            this.byId[element.element_identifier] = element;

            if (!this.byFamily[element.family]) {
                this.byFamily[element.family] = [];
            }
            this.byFamily[element.family].push(element);

            if (!this.byRequirements[element.requirement]) {
                this.byRequirements[element.requirement] = [];
            }
            this.byRequirements[element.requirement].push(element);

            if (!this.bySubRequirements[element.subRequirement]) {
                this.bySubRequirements[element.subRequirement] = [];
            }
            this.bySubRequirements[element.subRequirement].push(element);

            if (!this.bySubSubRequirements[element.subSubRequirement]) {
                this.bySubSubRequirements[element.subSubRequirement] = [];
            }
            this.bySubSubRequirements[element.subSubRequirement].push(element);
        }
        Object.freeze(this);
    }

    static sortById = (a: Element, b: Element) => {
        if (a.element_identifier < b.element_identifier) {
            return -1;
        }
        if (a.element_identifier > b.element_identifier) {
            return 1;
        }
        return 0;
    };

    static fromElements(
        elements: ElementWrapper[],
        type: ElementType,
        filterFn?: (element: ElementWrapper) => boolean | undefined,
    ) {
        let _elements = elements.filter(
            (element) => element.element.element_type === type,
        );

        if (filterFn) {
            _elements = _elements.filter(filterFn);
        }

        _elements = _elements.sort((a, b) =>
            ElementMapper.sortById(a.element, b.element),
        );

        return new ElementMapper(_elements);
    }
}

export class Manifest {
    readonly framework: Framework;
    readonly elements: ElementWrapper[];
    readonly families: ElementMapper;
    readonly requirements: ElementMapper;
    readonly securityRequirements: ElementMapper;
    readonly discussions: ElementMapper;
    readonly withdrawReason: ElementMapper;

    constructor(framework: Framework) {
        this.framework = framework;
        this.elements = framework.response.elements.elements.map(
            ElementWrapper.fromElement,
        );
        this.withdrawReason = ElementMapper.fromElements(
            this.elements,
            ElementType.WithdrawReason,
        );
        this.families = ElementMapper.fromElements(
            this.elements,
            ElementType.Family,
        );
        this.requirements = ElementMapper.fromElements(
            this.elements,
            ElementType.Requirement,
            (element) => {
                // Remove withdrawn
                return !!(element.title || element.text);
            },
        );
        this.securityRequirements = ElementMapper.fromElements(
            this.elements,
            ElementType.SecurityRequirement,
            (element) => {
                // Remove empty security requirements
                return !!element.text;
            },
        );
        this.discussions = ElementMapper.fromElements(
            this.elements,
            ElementType.Discussion,
        );
        Object.freeze(this);
    }
}

export const manifestV3 = new Manifest(frameworkV3);
export const manifestV2 = new Manifest(frameworkV2);

/**
 * Build a meta-description for a requirement page.
 *
 * Rev 2 requirements carry their prose directly on the requirement element,
 * but Rev 3 requirements have empty text — the prose lives on the child
 * security requirements. Fall back to stitching those together so every
 * requirement page ships a real description.
 */
export const getRequirementDescription = (
    manifest: Manifest,
    requirement_id: string,
    maxLength = 160,
): string | undefined => {
    const requirement = manifest.requirements.byId[requirement_id];
    let description = requirement?.text?.trim() ?? "";

    if (!description) {
        const securityRequirements =
            manifest.securityRequirements.byRequirements[requirement_id] ?? [];
        description = securityRequirements
            .map((element) => element.text?.trim())
            .filter(Boolean)
            .join(" ");
    }

    if (!description) {
        return undefined;
    }

    if (description.length > maxLength) {
        description = `${description.slice(0, maxLength - 1).trimEnd()}…`;
    }

    return description;
};
