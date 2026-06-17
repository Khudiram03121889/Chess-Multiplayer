import os
import re
import json

print("Starting iOS Xcode project SPM package patching...")

# 1. Patch project.pbxproj to enforce exactVersion requirements
proj_path = "ios/ChessTimeIOS.xcodeproj/project.pbxproj"
if not os.path.exists(proj_path):
    # Fallback to search for any xcodeproj
    for root, dirs, files in os.walk("ios"):
        if root.endswith(".xcodeproj"):
            proj_path = os.path.join(root, "project.pbxproj")
            break

if os.path.exists(proj_path):
    print(f"Found Xcode project file at {proj_path}. Patching requirements...")
    with open(proj_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Find and modify swift-collections package requirement block
    pattern_coll = r'(\/\* XCRemoteSwiftPackageReference "swift-collections" \*\/ = \{\s*isa = XCRemoteSwiftPackageReference;\s*repositoryURL = "[^"]*swift-collections[^"]*";\s*requirement = \{)([^}]+)(\};)'
    def replacer_coll(match):
        prefix = match.group(1)
        suffix = match.group(3)
        new_req = '\n\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = 1.1.4;\n\t\t\t'
        print("Changing swift-collections requirement to exactVersion 1.1.4 in project.pbxproj")
        return prefix + new_req + suffix

    new_content, count_coll = re.subn(pattern_coll, replacer_coll, content, flags=re.MULTILINE)

    # Find and modify swift-syntax package requirement block
    pattern_syn = r'(\/\* XCRemoteSwiftPackageReference "swift-syntax" \*\/ = \{\s*isa = XCRemoteSwiftPackageReference;\s*repositoryURL = "[^"]*swift-syntax[^"]*";\s*requirement = \{)([^}]+)(\};)'
    def replacer_syn(match):
        prefix = match.group(1)
        suffix = match.group(3)
        new_req = '\n\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = 600.0.1;\n\t\t\t'
        print("Changing swift-syntax requirement to exactVersion 600.0.1 in project.pbxproj")
        return prefix + new_req + suffix

    new_content, count_syn = re.subn(pattern_syn, replacer_syn, new_content, flags=re.MULTILINE)

    if count_coll > 0 or count_syn > 0:
        with open(proj_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully patched project.pbxproj requirements.")
    else:
        print("No matching SPM package requirements found in project.pbxproj.")
else:
    print("Warning: Could not find project.pbxproj to patch.")

# 2. Generate Package.resolved files to force lock version resolution in Xcode
resolved_content = {
  "pins" : [
    {
      "identity" : "swift-collections",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/apple/swift-collections.git",
      "state" : {
        "revision" : "d029d9d690cb616d61dce466ce78d2b998ccb086",
        "version" : "1.1.4"
      }
    },
    {
      "identity" : "swift-syntax",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/apple/swift-syntax.git",
      "state" : {
        "revision" : "0652d58079fa93d0f6226cbbe7071221f7db195b",
        "version" : "600.0.1"
      }
    }
  ],
  "version" : 2
}

# Resolve target folders for Package.resolved
paths_to_write = [
    "ios/ChessTimeIOS.xcodeproj/project.xcworkspace/xcshareddata/swiftpm",
    "ios/ChessTimeIOS.xcworkspace/xcshareddata/swiftpm"
]

for resolved_dir in paths_to_write:
    try:
        os.makedirs(resolved_dir, exist_ok=True)
        resolved_file = os.path.join(resolved_dir, "Package.resolved")
        with open(resolved_file, "w", encoding="utf-8") as f:
            json.dump(resolved_content, f, indent=2)
        print(f"Successfully wrote Package.resolved to {resolved_file}")
    except Exception as e:
        print(f"Error writing Package.resolved to {resolved_dir}: {e}")

print("iOS Xcode project SPM package patching complete.")
