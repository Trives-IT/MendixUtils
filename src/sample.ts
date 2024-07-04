import { domainmodels } from "mendixmodelsdk";
import { MendixUtils } from "./mendixutils";

const config = require("../config.json");

main().catch(console.error);

async function main() {
    // create app and open model
    const app = await MendixUtils.createApp(config.mendixtoken, 'testapp', config.defaultTemplate);
    const workingCopy = await app.createTemporaryWorkingCopy('main');
    const model = await workingCopy.openModel();

    // initialize new module
    MendixUtils.setSecurity(model, true);
    MendixUtils.deleteModule(model, "MyFirstModule");
    const newModule = await MendixUtils.getOrCreateModule(model, "MySecondModule");
    MendixUtils.createModuleRole(model, newModule, "Reader", "User");

    // create enum
    const newEnum = await MendixUtils.getOrCreateEnumeration(model, newModule, "Status");
    const newEnumValue = await MendixUtils.createEnumerationValue(model, newEnum, "open", "Open");
    await MendixUtils.createEnumerationValue(model, newEnum, "closed", "Closed");

    // create domain model
    const newPEntity = await MendixUtils.getOrCreateEntity(newModule, "MyFirstEntity", "Some documentation");
    newPEntity.location = { x: 100, y: 100 };
    const newNPEntity = await MendixUtils.getOrCreateEntity(newModule, "MySecondEntity", "Some more documentation", false);
    newNPEntity.location = { x: 100, y: 300 };
    MendixUtils.createEnumerationAttribute(newPEntity, "Status", newEnum, newEnumValue, "attribute documentation");
    MendixUtils.createAssociation(newNPEntity, newPEntity, 'Association_Name', domainmodels.AssociationType.Reference, domainmodels.AssociationOwner.Default);

    // commmit app
    console.info('Generation done, initiating commit');
    await model.flushChanges();
    await workingCopy.commitToRepository('main', { // make sure to change if you want to use SVN!
        commitMessage: 'Initial app generation',
    });

    console.info(`Completed sample generation: https://sprintr.home.mendix.com/link/project/${app.appId}`);
    process.exit();
}