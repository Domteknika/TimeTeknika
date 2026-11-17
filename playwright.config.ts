import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir:"./tests/ui",fullyParallel:false,workers:1,timeout:120000,retries:0,
 use:{baseURL:"http://127.0.0.1:4313",headless:true,locale:"fr-CH",viewport:{width:1440,height:1000},screenshot:"only-on-failure",trace:"retain-on-failure"},
 webServer:{command:"node scripts/test-ui-server.mjs",url:"http://127.0.0.1:4313",reuseExistingServer:false,timeout:60000},
 reporter:[["list"]]
});
