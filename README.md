# CMMC

> [!IMPORTANT]  
> CMMC currently uses NIST 800-171 Rev 2. If you want to get ahead of eventual compliance using Rev 3, then this application is for you. NIST provides a [change analysis](https://csrc.nist.gov/files/pubs/sp/800/171/r3/final/docs/sp800-171r2-to-r3-analysis.xlsx) for what's different.

It was challenging to find resources for [NIST 800-171 Revision 3](https://csrc.nist.gov/publications/detail/sp/800-171/rev-3/final) and [CMMC](https://dodcio.defense.gov/cmmc/About/) compliance, so this application was created to make writing SSP's a bit easier, without having to stare at an excel spreadsheet.

By going through the 800-171 controls, you can generate a markdown file with all statuses and notes for each security control.

![Demo](screenshots/demo.gif)

## Features

- Stores data client-side using [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- Generates a markdown file for compliance (Good for System Security Plan!)
- Generates a POAM in CSV for unimplemented requirements
- Allows for exporting and importing the database for archived storage
- Offline usage with PWA and Service Workers

## Usage

1. Go to [CMMC app](https://app.getcmmc.consulting/)
2. Start working through security controls for a family
3. Choose whether it has been implemented or not, and any notes
4. Click the upper right menu
5. Click `Generate Report` to download a markdown document
6. Click `Generate POAM` to download a CSV for gap items

### Icon Meanings

- 🟢 A family, requirement, or security requirement is implemented.
- 🔴 A family, requirement, or security requirement is not implemented (e.g. any security requirement within a family/requirement is not implemented).
- 🟡 A family or requirement is partially implemented (e.g. any security requirement within a family/requirement is partially implemented)
- ⚫ A family, requirement, or security requirement is not applicable.
- ⚪ A family, requirement, or security requirement has not been started (default).
- 🚧 A family or requirement has remaining work.

## Privacy

All data is stored locally on your device using [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). There are no privacy concerns, as there are no 3rd party tracking, analytic, or external servers used to for this application.

## Resources

- [NIST 800-171 Revision 3 Final](https://csrc.nist.gov/publications/detail/sp/800-171/rev-3/final).
- JSON used for the application from [csrc.nist.gov](https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/sp_800_171_3_0_0/export/json?element=all).
- [CMMC COA](https://cmmc-coa.com/) is a great resource as well for CMMC.

## License

This project is licensed under the MIT License and has no affiliation with NIST.
