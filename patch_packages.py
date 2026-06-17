import os
import re

print("Scanning node_modules for Package.swift files...")
patched_count = 0

for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file == "Package.swift":
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                
                modified = False
                
                # 1. Check and downgrade swift-tools-version if greater than 6.1
                match = re.match(r"^//\s*swift-tools-version:\s*([\d\.]+)", content)
                if match:
                    version = match.group(1)
                    parts = version.split('.')
                    if len(parts) >= 2:
                        try:
                            major, minor = int(parts[0]), int(parts[1])
                            if major > 6 or (major == 6 and minor > 1):
                                print(f"Downgrading tools-version in {path} from {version} to 6.1")
                                content = re.sub(
                                    r"^//\s*swift-tools-version:\s*[\d\.]+",
                                    "// swift-tools-version: 6.1",
                                    content
                                )
                                modified = True
                        except ValueError:
                            pass
                
                # 2. Pin apple/swift-collections to 1.1.4 (compatible with Swift 6.1)
                if "swift-collections" in content and "1.1.4" not in content:
                    print(f"Pinning swift-collections in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-collections(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-collections.git", exact: "1.1.4")',
                        content
                    )
                    modified = True
                
                # 3. Pin apple/swift-syntax to 600.0.1 (compatible with Swift 6.0/6.1)
                if "swift-syntax" in content and "600.0.1" not in content:
                    print(f"Pinning swift-syntax in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-syntax(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-syntax.git", exact: "600.0.1")',
                        content
                    )
                    modified = True

                if modified:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"Successfully patched {path}")
                    patched_count += 1
            except Exception as e:
                print(f"Error processing {path}: {e}")

print(f"Scan complete. Patched {patched_count} Package.swift file(s).")

# 4. Scan all Swift files in node_modules and replace "weak let" with "weak var" to fix Swift 6 compiler error
print("Scanning node_modules for Swift files to fix 'weak let'...")
swift_patched = 0
for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file.endswith(".swift"):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                
                content_modified = False
                if "weak let" in content:
                    print(f"Fixing 'weak let' -> 'weak var' in {path}")
                    content = content.replace("weak let", "weak var")
                    # If we changed to weak var, it makes it mutable, which breaks Sendable. Change to @unchecked Sendable
                    if ": Sendable" in content and ": @unchecked Sendable" not in content:
                        content = content.replace(": Sendable", ": @unchecked Sendable")
                    content_modified = True
                
                # Fix trailing comma in JavaScriptRuntime.swift
                if "JavaScriptRuntime.swift" in path and "_ arguments: consuming JavaScriptValuesBuffer," in content:
                    print(f"Fixing trailing comma in {path}")
                    content = content.replace("_ arguments: consuming JavaScriptValuesBuffer,", "_ arguments: consuming JavaScriptValuesBuffer")
                    content_modified = True

                if content_modified:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    swift_patched += 1
            except Exception as e:
                print(f"Error patching Swift file {path}: {e}")
print(f"Fixed {swift_patched} Swift file(s).")

