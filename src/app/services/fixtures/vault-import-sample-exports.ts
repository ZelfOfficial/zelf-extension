/**
 * Synthetic vault export samples for QA and unit tests.
 * Keep in sync with docs/qa/vault-import-samples/*.csv (fake credentials only).
 */
export const LASTPASS_SAMPLE_CSV = `url,username,password,extra,name,grouping,fav
https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,"Note with, comma",Example Mail,Personal,0
https://github.com/,qa-github-user,TestPass_Gh_7y!,Repo access note,GitHub QA,Dev,1
http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,,HTTPBin Basic,QA,0
https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99","Quoted password edge case",Shop Account,Shopping,0
https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,Do not use real creds,Zelf Staging,Work,0`;

export const ONEPASSWORD_SAMPLE_CSV = `Title,URL,Username,Password,Notes,One-time password,Favorite,Archived,Tags
Example Mail,https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,Note with comma,,,false,false,Personal
GitHub QA,https://github.com/,qa-github-user,TestPass_Gh_7y!,Repo access note,,,false,false,Dev
HTTPBin Basic,http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,,,,false,false,QA
Shop Account,https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99",Quoted password edge case,,,false,false,Shopping
Zelf Staging,https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,Do not use real creds,,,false,false,Work`;

export const ONEPASSWORD_MINIMAL_SAMPLE_CSV = `Title,URL,Username,Password,Notes
Example Mail,https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,Note with comma
GitHub QA,https://github.com/,qa-github-user,TestPass_Gh_7y!,Repo access note
HTTPBin Basic,http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,
Shop Account,https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99",Quoted password edge case
Zelf Staging,https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,Do not use real creds`;

export const CHROME_SAMPLE_CSV = `name,url,username,password,note
Example Mail,https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,Note with comma
GitHub QA,https://github.com/,qa-github-user,TestPass_Gh_7y!,Repo access note
HTTPBin Basic,http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,
Shop Account,https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99",Quoted password edge case
Zelf Staging,https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,Do not use real creds`;

export const BITWARDEN_SAMPLE_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
Personal,0,login,Example Mail,"Note with, comma",,0,https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,
Dev,1,login,GitHub QA,Repo access note,,0,https://github.com/,qa-github-user,TestPass_Gh_7y!,
QA,0,login,HTTPBin Basic,,,0,http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,
,0,login,Shop Account,Quoted password edge case,,0,https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99",
Work,0,login,Zelf Staging,Do not use real creds,,0,https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,`;

export const KEEPASSXC_SAMPLE_CSV = `Group,Title,Username,Password,URL,Notes
Root/Personal,Example Mail,qa.mail@example.com,TestPass_Mail_9x!,https://mail.example.com/,Note with comma
Root/Dev,GitHub QA,qa-github-user,TestPass_Gh_7y!,https://github.com/,Repo access note
Root/QA,HTTPBin Basic,httpbin-user,TestPass_Http_3z!,http://httpbin.org/basic-auth/user/passwd,
Root,Shop Account,shopper@example.org,"Pass""Quote""99",https://shop.example.org/cart,Quoted password edge case
Root/Work,Zelf Staging,zelf-qa-tester,ZelfKeys_Import_Only_1!,https://app.staging.zelf.local/,Do not use real creds`;

export const APPLE_SAMPLE_CSV = `Title,URL,Username,Password,Notes,OTPAuth
Example Mail,https://mail.example.com/,qa.mail@example.com,TestPass_Mail_9x!,Note with comma,
GitHub QA,https://github.com/,qa-github-user,TestPass_Gh_7y!,Repo access note,
HTTPBin Basic,http://httpbin.org/basic-auth/user/passwd,httpbin-user,TestPass_Http_3z!,,
Shop Account,https://shop.example.org/cart,shopper@example.org,"Pass""Quote""99",Quoted password edge case,
Zelf Staging,https://app.staging.zelf.local/,zelf-qa-tester,ZelfKeys_Import_Only_1!,Do not use real creds,`;
