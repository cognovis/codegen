import type { CanonicalUrl, PkgName, TypeSchema } from "../types";

export type TypeSchemaCollisions = Record<
    PkgName,
    Record<
        CanonicalUrl,
        {
            typeSchema: TypeSchema;
            sourcePackage: PkgName;
            sourceCanonical: CanonicalUrl;
        }[]
    >
>;

export type CollisionResolution = { package: string; canonical: string };
export type ResolveCollisionsConf = Record<string, CollisionResolution>;

export type IrConf = {
    treeShake?: TreeShakeConf;
    /** Rule defaults applied to every treeShake root; a rule's own value wins. */
    treeShakeDefaults?: TreeShakeDefaults;
    promoteLogical?: LogicalPromotionConf;
    resolveCollisions?: ResolveCollisionsConf;
};

export type TreeShakeDefaults = Pick<TreeShakeRule, "followReferences">;

export type LogicalPromotionConf = Record<PkgName, CanonicalUrl[]>;

export type TreeShakeConf = Record<string, Record<string, TreeShakeRule>>;

export type TreeShakeRule = {
    ignoreFields?: string[];
    selectFields?: string[];
    ignoreExtensions?: string[];
    /** Also generate types for the schema's reference targets (base resources
     *  and target profiles). Non-transitive: followed types keep their own
     *  reference targets as plain string literals. Default: false. */
    followReferences?: boolean;
};

export type IrReport = {
    treeShake?: TreeShakeReport;
    logicalPromotion?: LogicalPromotionReport;
    collisions?: TypeSchemaCollisions;
    resolveCollisions?: ResolveCollisionsConf;
};

export type LogicalPromotionReport = {
    packages: Record<
        PkgName,
        {
            promotedCanonicals: CanonicalUrl[];
        }
    >;
};

export type TreeShakeReport = {
    skippedPackages: PkgName[];
    packages: Record<
        PkgName,
        {
            skippedCanonicals: CanonicalUrl[];
            canonicals: Record<
                CanonicalUrl,
                {
                    skippedFields: string[];
                }
            >;
        }
    >;
};
