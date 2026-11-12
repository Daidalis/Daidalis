// Read old launcher settings without changing the caller's environment.
// Explicit Daidalis values, including empty overrides, remain authoritative.
static NSDictionary *DaidalisEnvironment(NSDictionary *environment) {
    NSMutableDictionary *normalized=[environment mutableCopy];
    for(NSString *prefix in @[@"MANTA_",@"MBSE_"]) {
        for(NSString *key in environment) {
            if(![key hasPrefix:prefix])continue;
            NSString *name=[@"DAIDALIS_" stringByAppendingString:[key substringFromIndex:prefix.length]];
            if(normalized[name]==nil)normalized[name]=environment[key];
        }
    }
    return normalized;
}

static BOOL DaidalisHealthApp(NSString *application) {
    return [application isEqual:@"daidalis"]||[application isEqual:@"mbse-studio"];
}
