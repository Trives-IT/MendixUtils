import * as fs from "fs";
import path from "path";
import { IModel, domainmodels, enumerations, navigation, pages, projects, security, settings, texts } from "mendixmodelsdk";
import { App, MendixPlatformClient, RepositoryType, setPlatformConfig } from "mendixplatformsdk";

const RESERVED_WORDS: string[] = fs.readFileSync(path.resolve(__dirname, "../reservedwords.txt"), 'utf-8').split(/\r\n|\r|\n/);

export type Constructable<I> = { new(...args: any[]): I; };

namespace MendixUtils {
    export type ConstructableAttributeType<T extends domainmodels.AttributeType> = Constructable<T> & {
        createInAttributeUnderType(mxElement: domainmodels.Attribute): T;
    };
}

export class MendixUtils {
    /**
     * Removes all characters that are not alphanumeric or an underscore
     * @param s String to clean
     * @returns Cleaned string
     */
    public static cleanName(s: string): string {
        let result = s.replaceAll(/[^a-zA-Z\d_]/g, "");
        if (RESERVED_WORDS.includes(result) || /^\d/.test(result[0])) {
            result = '_' + result;
        }
        return result;
    }

    private static client = new MendixPlatformClient();

    /**
     * 
     * @param mxtoken 
     * @param appname 
     * @param templateid 
     * @param repositoryType 
     * @returns 
     */
    public static async createApp(mxtoken: string, appname: string, templateid?: string, repositoryType: RepositoryType = "git"): Promise<App> {
        setPlatformConfig({ mendixToken: mxtoken });

        appname = MendixUtils.cleanName(appname);
        console.info(`Creating app with name ${appname} and templateId ${templateid}`);
        const mxApp = await MendixUtils.client.createNewApp(appname, {
            summary: "Automatically created Mendix project for automatic OS migration",
            repositoryType: repositoryType,
            templateId: templateid,
        });
        console.info(`App created with id ${mxApp.appId} and name ${appname}`);

        return mxApp;
    }

    /**
     * 
     * @param mxtoken 
     * @param appid 
     * @returns 
     */
    public static async openApp(mxtoken: string, appid: string): Promise<App> {
        setPlatformConfig({ mendixToken: mxtoken });

        const mxApp = MendixUtils.client.getApp(appid);
        const repositoryType = (await mxApp.getRepository().getInfo()).type;
        console.info(`Opened app ${mxApp.appId} with repo type ${repositoryType}`);

        return mxApp;
    }

    /**
     * 
     * @param model 
     * @returns 
     */
    public static async getProjectSecurity(model: IModel): Promise<security.ProjectSecurity> {
        return await model.allProjectSecurities()[0].load();
    }

    /**
     * 
     * @param model 
     * @returns 
     */
    public static async getOrCreateLanguageSettings(model: IModel): Promise<settings.LanguageSettings> {
        const projectSettings = await model.allProjectSettings()[0].load();
        return projectSettings.settingsParts.find((p) => p instanceof settings.LanguageSettings) as settings.LanguageSettings
            ?? settings.LanguageSettings.createIn(projectSettings);
    }

    /**
     * 
     * @param model 
     * @returns 
     */
    public static async getNavigationProfiles(model: IModel): Promise<navigation.NavigationProfile[]> {
        return (await model.allNavigationDocuments()[0].load()).profiles.filter((p): p is navigation.NavigationProfile => p instanceof navigation.NavigationProfile);
    }

    /**
     * 
     * @param model 
     * @param production 
     */
    public static async setSecurity(model: IModel, production: boolean): Promise<void> {
        const projectSecurity = await MendixUtils.getProjectSecurity(model);
        projectSecurity.securityLevel = production ? security.SecurityLevel.CheckEverything : security.SecurityLevel.CheckNothing;
    }

    /**
     * 
     * @param model 
     * @param moduleName 
     * @returns 
     */
    public static async getModule(model: IModel, moduleName: string): Promise<projects.Module | undefined> {
        moduleName = MendixUtils.cleanName(moduleName);
        const existingModule = model.findModuleByQualifiedName(moduleName);
        return existingModule ? (await existingModule.domainModel.load()).containerAsModule : undefined;
    }

    /**
     * 
     * @param model 
     * @param moduleName 
     * @returns 
     */
    public static async getOrCreateModule(model: IModel, moduleName: string): Promise<projects.Module> {
        const existingModule = await MendixUtils.getModule(model, moduleName);
        if (existingModule) return existingModule;

        const newModule = projects.Module.createIn(model.allProjects()[0]);
        domainmodels.DomainModel.createIn(newModule);
        security.ModuleSecurity.createIn(newModule);
        newModule.name = MendixUtils.cleanName(moduleName);

        return newModule;
    }

    /**
     * 
     * @param model 
     * @param moduleName 
     * @returns 
     */
    public static async deleteModule(model: IModel, moduleName: string): Promise<void> {
        const module = model.findModuleByQualifiedName(MendixUtils.cleanName(moduleName));
        if (!module) return;

        const domainModel = await module.domainModel.load();

        // delete module roles from user roles (mapping)
        (await MendixUtils.getProjectSecurity(model)).userRoles.forEach(async ur =>
            domainModel.containerAsModule.moduleSecurity.moduleRoles.forEach(mr => ur.moduleRoles.remove(mr))
        );
        module.delete();

        // replace Home page by System microflow and menu items by Do Nothing; TODO: this does not (yet) deal with sub items
        const responseWebNavigationProfile = (await MendixUtils.getNavigationProfiles(model)).find(p => p.kind == navigation.ProfileKind.Responsive);
        if (responseWebNavigationProfile) {
            if (responseWebNavigationProfile.homePage.pageQualifiedName!.startsWith(moduleName)) {
                responseWebNavigationProfile.homePage.page = null;
                (responseWebNavigationProfile.homePage as any)["__microflow"].updateWithRawValue("System.ShowHomePage");
            }

            responseWebNavigationProfile.menuItemCollection.items.filter(i => i.action instanceof pages.PageClientAction && i.action.pageSettings.pageQualifiedName!.startsWith(moduleName)).map(i => pages.NoClientAction.createInMenuItemUnderAction(i));
        }

    }

    /**
     * 
     * @param module 
     * @param moduleRoleName 
     * @returns 
     */
    public static async getModuleRole(module: projects.Module, moduleRoleName: string): Promise<security.ModuleRole | undefined> {
        return (await module.moduleSecurity.load()).moduleRoles.find(r => r.name == moduleRoleName)
    }

    /**
     * 
     * @param model 
     * @param module 
     * @param moduleRoleName 
     * @param useRoleName 
     * @returns 
     */
    public static async createModuleRole(model: IModel, module: projects.Module, moduleRoleName: string, useRoleName: string): Promise<security.ModuleRole> {
        const newModuleRole = security.ModuleRole.createIn(await module.moduleSecurity.load());
        newModuleRole.name = moduleRoleName;
        (await MendixUtils.getProjectSecurity(model)).userRoles.find(u => u.name == useRoleName)?.moduleRoles.push(newModuleRole);
        return newModuleRole;
    }

    /**
     * 
     * @param module 
     * @param entityName 
     * @returns 
     */
    public static async getEntity(module: projects.Module, entityName: string): Promise<domainmodels.Entity | undefined> {
        entityName = MendixUtils.cleanName(entityName);
        const existingEntity = module.domainModel.entities.find(e => e.name == entityName);
        return existingEntity ? existingEntity.load() : undefined;
    }

    /**
     * 
     * @param module 
     * @param entityName 
     * @param documentation 
     * @param persistable 
     * @returns 
     */
    public static async getOrCreateEntity(module: projects.Module, entityName: string, documentation: string = "", persistable: boolean = true): Promise<domainmodels.Entity> {
        const existingEntity = await MendixUtils.getEntity(module, entityName);
        if (existingEntity) return existingEntity;

        const newEntity = domainmodels.Entity.createIn(await module.domainModel.load());
        newEntity.name = MendixUtils.cleanName(entityName);;
        newEntity.documentation = documentation;

        const newNoGeneralization = domainmodels.NoGeneralization.createIn(newEntity);
        newNoGeneralization.persistable = persistable;

        return newEntity;
    }

    /**
     * 
     * @param entity 
     * @param moduleRoles 
     * @param defaultAccessRights 
     * @param allowCreate 
     * @param allowDelete 
     * @returns 
     */
    public static createAccessRule(entity: domainmodels.Entity, moduleRoles: security.ModuleRole[], defaultAccessRights: domainmodels.MemberAccessRights = domainmodels.MemberAccessRights.None, allowCreate: boolean = false, allowDelete: boolean = false): domainmodels.AccessRule {
        const newAR = domainmodels.AccessRule.createInEntityUnderAccessRules(entity);
        newAR.defaultMemberAccessRights = defaultAccessRights;
        newAR.allowCreate = allowCreate;
        newAR.allowDelete = allowDelete;
        moduleRoles.forEach(mr => newAR.moduleRoles.push(mr));

        // set default rights for all members; TODO: does not include members from generalization!
        entity.attributes.forEach(attr => MendixUtils.setAttributeAccess(newAR, attr, defaultAccessRights));
        entity.containerAsDomainModel.associations.filter(a => a.parent == entity).forEach(assoc => MendixUtils.setAssociationAccess(newAR, assoc, defaultAccessRights));

        return newAR;
    }

    /**
     * 
     * @param accessRule 
     * @param association 
     * @param accessRights 
     */
    private static setAssociationAccess(accessRule: domainmodels.AccessRule, association: domainmodels.AssociationBase, accessRights: domainmodels.MemberAccessRights) {
        let memberAccess = accessRule.memberAccesses.find((ma) => ma.association?.name == association.name);
        if (!memberAccess) {
            memberAccess = domainmodels.MemberAccess.createIn(accessRule);
            memberAccess.association = association;
        }
        memberAccess.accessRights = accessRights;
    }

    /**
     * 
     * @param accessRule 
     * @param attribute 
     * @param accessRights 
     */
    private static setAttributeAccess(accessRule: domainmodels.AccessRule, attribute: domainmodels.Attribute, accessRights: domainmodels.MemberAccessRights) {
        let memberAccess = accessRule.memberAccesses.find((ma) => ma.attribute?.name == attribute.name);
        if (!memberAccess) {
            memberAccess = domainmodels.MemberAccess.createIn(accessRule);
            memberAccess.attribute = attribute;
        }
        memberAccess.accessRights = attribute.type instanceof domainmodels.AutoNumberAttributeType && accessRights == domainmodels.MemberAccessRights.ReadWrite
            ? domainmodels.MemberAccessRights.ReadOnly
            : accessRights;
    }

    /**
     * 
     * @param entity 
     * @param value 
     */
    public static setHasOwner(entity: domainmodels.Entity, value: boolean = true) {
        if (entity.generalization instanceof domainmodels.NoGeneralization)
            entity.generalization.hasOwner = value;
    }

    /**
     * 
     * @param entity 
     * @param value 
     */
    public static setHasCreatedDate(entity: domainmodels.Entity, value: boolean = true) {
        if (entity.generalization instanceof domainmodels.NoGeneralization)
            entity.generalization.hasCreatedDate = value;
    }

    /**
     * 
     * @param entity 
     * @param value 
     */
    public static setHasChangedBy(entity: domainmodels.Entity, value: boolean = true) {
        if (entity.generalization instanceof domainmodels.NoGeneralization)
            entity.generalization.hasChangedBy = value;
    }

    /**
     * 
     * @param entity 
     * @param value 
     */
    public static setHasChangedDate(entity: domainmodels.Entity, value: boolean = true) {
        if (entity.generalization instanceof domainmodels.NoGeneralization)
            entity.generalization.hasChangedDate = value;
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @returns 
     */
    public static getAttribute(entity: domainmodels.Entity, attributeName: string): domainmodels.Attribute | undefined {
        return entity.attributes.find(attr => attr.name == attributeName);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param attrType 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    private static createAttribute(entity: domainmodels.Entity, attributeName: string, attrType: MendixUtils.ConstructableAttributeType<domainmodels.AttributeType>, defaultValue?: string, documentation: string = ""): domainmodels.Attribute {
        attributeName = MendixUtils.cleanName(attributeName);

        const newAttribute = domainmodels.Attribute.createIn(entity);

        newAttribute.name = attributeName;
        newAttribute.documentation = documentation;
        attrType.createInAttributeUnderType(newAttribute);

        const attributeValue = domainmodels.StoredValue.createIn(newAttribute);
        if (defaultValue) attributeValue.defaultValue = defaultValue;

        // update access rules
        entity.accessRules.forEach(ar => MendixUtils.setAttributeAccess(ar, newAttribute, ar.defaultMemberAccessRights));

        return newAttribute;
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createAutonumberAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue: bigint = 1n, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.AutoNumberAttributeType, defaultValue.toString(), documentation);
    }

    /**
     * 
     * @param entity
     * @param attributeName 
     * @param documentation 
     * @returns 
     */
    public static createBinaryAttribute(entity: domainmodels.Entity, attributeName: string, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.BinaryAttributeType, undefined, documentation);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createBooleanAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue: boolean = false, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.BooleanAttributeType, defaultValue.toString(), documentation);
    }


    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param localize 
     * @param defaultCurrentDateTime 
     * @param documentation 
     * @returns 
     */
    public static createDateTimeAttribute(entity: domainmodels.Entity, attributeName: string, localize: boolean = true, defaultCurrentDateTime: boolean = false, documentation: string = ""): domainmodels.Attribute {
        const newEnumAttribute = MendixUtils.createAttribute(entity, attributeName, domainmodels.DateTimeAttributeType, defaultCurrentDateTime ? "[%CurrentDateTime%]" : "", documentation);
        (newEnumAttribute.type as domainmodels.DateTimeAttributeType).localizeDate = localize;
        return newEnumAttribute;
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createDecimalAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue?: number, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.DecimalAttributeType, defaultValue?.toString(), documentation);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param enumE 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createEnumerationAttribute(entity: domainmodels.Entity, attributeName: string, enumE: enumerations.Enumeration, defaultValue?: enumerations.EnumerationValue, documentation: string = ""): domainmodels.Attribute {
        const newEnumAttribute = MendixUtils.createAttribute(entity, attributeName, domainmodels.EnumerationAttributeType, defaultValue?.name, documentation);
        (newEnumAttribute.type as domainmodels.EnumerationAttributeType).enumeration = enumE;
        return newEnumAttribute;
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createHashedStringAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue?: string, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.HashedStringAttributeType, defaultValue, documentation);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createIntegerAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue?: number, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.IntegerAttributeType, defaultValue?.toString(), documentation);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createLongAttribute(entity: domainmodels.Entity, attributeName: string, defaultValue?: bigint, documentation: string = ""): domainmodels.Attribute {
        return this.createAttribute(entity, attributeName, domainmodels.LongAttributeType, defaultValue?.toString(), documentation);
    }

    /**
     * 
     * @param entity 
     * @param attributeName 
     * @param maxLength 
     * @param defaultValue 
     * @param documentation 
     * @returns 
     */
    public static createStringAttribute(entity: domainmodels.Entity, attributeName: string, maxLength: number = 200, defaultValue?: string, documentation: string = ""): domainmodels.Attribute {
        const newEnumAttribute = MendixUtils.createAttribute(entity, attributeName, domainmodels.StringAttributeType, defaultValue, documentation);
        (newEnumAttribute.type as domainmodels.StringAttributeType).length = maxLength;
        return newEnumAttribute;
    }

    /**
     * 
     * @param module 
     * @param assocName 
     * @returns 
     */
    public static async getAssociation(module: projects.Module, assocName: string): Promise<domainmodels.AssociationBase | undefined> {
        return module.domainModel.associations.find(assoc => assoc.name == assocName)?.load()
            ?? module.domainModel.crossAssociations.find(assoc => assoc.name == assocName)?.load();
    }

    /**
     * 
     * @param parentEntity 
     * @param childEntity 
     * @param type Use Reference for 1:1 or 1:n associations, use ReferenceSet for m:n associations
     * @param owner Use Both for 1:1 or m:n associations, use Default for 1:n of m:n associations
     */
    public static createAssociation(parentEntity: domainmodels.Entity, childEntity: domainmodels.Entity, name: string, type: domainmodels.AssociationType, owner: domainmodels.AssociationOwner, childDeleteBehavior: domainmodels.DeletingBehavior = domainmodels.DeletingBehavior.DeleteMeButKeepReferences, parentDeleteBehavior: domainmodels.DeletingBehavior = domainmodels.DeletingBehavior.DeleteMeButKeepReferences, documentation: string = "") {
        const newAssociation: domainmodels.Association | domainmodels.CrossAssociation = parentEntity.containerAsDomainModel !== childEntity.containerAsDomainModel
            ? domainmodels.CrossAssociation.createIn(parentEntity.containerAsDomainModel)
            : domainmodels.Association.createIn(parentEntity.containerAsDomainModel);

        newAssociation.parent = parentEntity;
        newAssociation.child = childEntity;
        newAssociation.name = MendixUtils.cleanName(name);
        newAssociation.type = type;
        newAssociation.owner = owner;
        newAssociation.documentation = documentation;
        newAssociation.deleteBehavior.parentDeleteBehavior = parentDeleteBehavior;
        newAssociation.deleteBehavior.childDeleteBehavior = childDeleteBehavior;

        if (parentDeleteBehavior == domainmodels.DeletingBehavior.DeleteMeIfNoReferences)
            texts.Text.createInAssociationDeleteBehaviorUnderParentErrorMessage(newAssociation.deleteBehavior);
        if (childDeleteBehavior == domainmodels.DeletingBehavior.DeleteMeIfNoReferences)
            texts.Text.createInAssociationDeleteBehaviorUnderChildErrorMessage(newAssociation.deleteBehavior);

        parentEntity.accessRules.forEach(ar => MendixUtils.setAssociationAccess(ar, newAssociation, ar.defaultMemberAccessRights));
    }

    /**
     * 
     * @param model 
     * @param module 
     * @param enumName 
     * @returns 
     */
    public static async getEnumeration(model: IModel, module: projects.Module, enumName: string): Promise<enumerations.Enumeration | undefined> {
        enumName = MendixUtils.cleanName(enumName);
        const existingEnum = model.findEnumerationByQualifiedName(`${module.name}.${enumName}`);
        return existingEnum ? existingEnum.load() : undefined;
    }

    /**
     * 
     * @param model 
     * @param module 
     * @param enumName 
     * @returns 
     */
    public static async getOrCreateEnumeration(model: IModel, module: projects.Module, enumName: string): Promise<enumerations.Enumeration> {
        const existingEnum = await MendixUtils.getEnumeration(model, module, enumName);
        if (existingEnum) return existingEnum;

        const newEnumeration = enumerations.Enumeration.createIn(module);
        newEnumeration.name = MendixUtils.cleanName(enumName);

        return newEnumeration;
    }

    /**
     * 
     * @param model 
     * @param enumE 
     * @param key 
     * @param value 
     * @returns 
     */
    public static async createEnumerationValue(model: IModel, enumE: enumerations.Enumeration, key: string, value: string): Promise<enumerations.EnumerationValue> {
        const newEnumValue = enumerations.EnumerationValue.createIn(enumE);
        newEnumValue.name = MendixUtils.cleanEnumKey(key);
        const newEnumValueText = texts.Text.createInEnumerationValueUnderCaption(newEnumValue);
        const newTranslation = texts.Translation.createIn(newEnumValueText);
        newTranslation.languageCode = (await MendixUtils.getOrCreateLanguageSettings(model)).defaultLanguageCode;
        newTranslation.text = value;

        return newEnumValue;
    }

    /**
     * 
     * @param enumE 
     * @param key 
     * @returns 
     */
    public static getEnumerationValue(enumE: enumerations.Enumeration, key: string): enumerations.EnumerationValue | undefined {
        key = MendixUtils.cleanEnumKey(key);
        return enumE.values.find(enumV => enumV.name == key);
    }

    /**
     * 
     * @param key 
     * @returns 
     */
    private static cleanEnumKey(key: string): string {
        key = MendixUtils.cleanName(key);
        // if key starts with a number, prefix it with an underscore
        if (/^ [0 - 9]$ /.test(key[0])) key = '_' + key;
        return key;
    }
}