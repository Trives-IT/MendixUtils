# Description

This repository contains a Mendix Utils library to easily get and create elements in a Mendix application model. You can use this is your project to automate generation and adaptation of Mendix models.

# Requirements

- Install NodeJS v20 or higher
- Set up your Node environment: https://docs.mendix.com/apidocs-mxsdk/mxsdk/setting-up-your-development-environment/#setting
- Make sure you have a Mendix account
- Set up your Mendix Personal Access Token: https://docs.mendix.com/community-tools/mendix-profile/user-settings/#pat

# Installation

After ensuring the requirements above and downloading (cloning) this repository:

- npm install
- create a config.json file in the root directory that looks like this:

```
{
"mendixtoken": "1234567890qwertyuiopasdfghjklzxcvbnm",
"defaultTemplate": "6b35cbde-d186-4de8-982f-513cfa34fb7f"
}
```

- change the value for mendix token with your own create PAT (see above) and the default template as desired. If you leave it out, Mendix will determine the version and template :) Current value is for the blank web app on Mendix 10.6.3, see https://marketplace.mendix.com/link/component/51830

# Usage

- npm run clean: to clean build directory;
- npm run build: to compile ts to js (tsc);
- npm run sample: runs the sample script that creates a new Mendix application with some default module and entities.

# Limitations

- This script currently only creates the Mendix domain model, including entities, attributes and associations. It does not (yet) produce pages or flows of any kind. You can enhance the generated application with Mendix Studio.
- Probably many more... (this is just a sample project!)

# Known issues

- Error handling is poor. If the input file contains unexpected characters, a hard error may be thrown, but the application will not be deleted.
- When using FileDocument as specialization, entity access is not completely automatically updated. This results in a model error in Mendix Studio. This is easily solved by clicking the 'Update security' button in the domain model editor.

# Background

- Mendix SDK reference guide: https://docs.mendix.com/apidocs-mxsdk/mxsdk/sdk-refguide/
- On JavaScript, TypeScript, and their differences: https://docs.mendix.com/apidocs-mxsdk/mxsdk/javascript-typescript-resources/
  Presenting the Mendix Platform SDK and Model API: https://www.mendix.com/blog/presenting-the-mendix-platform-sdk/
- Latest API doc: https://apidocs.rnd.mendix.com/platformsdk/latest/index.html

# License

This project is licensed under the GPLv3.
This license allows to run, study, share, and modify the software but derivative work must be distributed under the same or equivalent license terms.
