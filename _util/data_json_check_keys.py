import sys
import json
import os

foreign_keys = [ "data", "events", "people", "publications" ]

ids = {}
data_dir = os.path.join(os.path.dirname(__file__), "..", "_data")
for foreign_key in foreign_keys:
    with open(os.path.join(data_dir, foreign_key + ".json")) as file:
        data_list = json.load(file)
    ids[foreign_key] = [item["id"] for item in data_list]

    seen = set()
    for key in ids[foreign_key]:
        if key in seen:
            print(f"Duplicate ID '{key}' in {foreign_key}.json", file=sys.stderr)
            sys.exit(1)
        seen.add(key)

for filename in sys.argv[1:]:
    if filename.endswith("downloads-bda-team.json"):
        print(filename + ": skip")
        continue

    print(filename)
    with open(filename) as file:
        data_list = json.load(file)
    for item in data_list:
        for foreign_key in foreign_keys:
            if foreign_key in item:
                for key in item[foreign_key]:
                    if key not in ids[foreign_key]:
                        print(f"Item '{key}' referenced in attribute '{foreign_key}' of '{item['id']}' in {filename} does not exist in {foreign_key}.json", file=sys.stderr)
                        sys.exit(1)

