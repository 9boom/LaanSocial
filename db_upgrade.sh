#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGO_DIR="$SCRIPT_DIR/public/assets/sim_db/universities_logos"
MONGO_FILE=$(mktemp)

trap "rm -f $MONGO_FILE" EXIT

# Load .env (handle Windows line endings)
export $(grep -v '^#' "$SCRIPT_DIR/.env" | sed 's/\r$//' | xargs)

echo "Preparing data..."

# Parse filename: "1.จุฬาลงกรณ์_จฬ.png" -> "จุฬาลงกรณ์ [จฬ]"
parse_name() {
    echo "$1" | sed 's/^[0-9]*\.//' | sed 's/\.png$//' | sed 's/_\([^_]*\)$/ [\1]/'
}

# Generate random UUID (fallback if uuidgen not available)
gen_uuid() {
    if command -v uuidgen &>/dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        node -e "console.log(require('crypto').randomUUID())"
    fi
}

# Start generating MongoDB script
cat > "$MONGO_FILE" << 'SCRIPT'
const universities = [
SCRIPT

COUNT=0
for file in "$LOGO_DIR"/*.png; do
    [ -f "$file" ] || continue
    
    name=$(parse_name "$(basename "$file")")
    uuid=$(gen_uuid)
    ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    
    [[ $COUNT -gt 0 ]] && echo "," >> "$MONGO_FILE"
    
    cat >> "$MONGO_FILE" << EOF
  { uniroom_id: "uninum_$uuid", uniroom_name: "$name", created_at: new Date("$ts") }
EOF
    
    ((COUNT++))
done

# Complete the script
cat >> "$MONGO_FILE" << 'SCRIPT'
];

db = db.getSiblingDB("LaanDBDevelopment");

// Skip duplicate uniroom_name (both existing in DB and duplicate in this batch)
const existingNames = new Set(
  db.universities.find(
    { uniroom_name: { $in: universities.map(u => u.uniroom_name) } },
    { uniroom_name: 1, _id: 0 }
  ).toArray().map(u => u.uniroom_name)
);

const seenNames = new Set();
const filteredUniversities = [];
const skippedNames = [];

for (const university of universities) {
  if (existingNames.has(university.uniroom_name) || seenNames.has(university.uniroom_name)) {
    skippedNames.push(university.uniroom_name);
    continue;
  }

  seenNames.add(university.uniroom_name);
  filteredUniversities.push(university);
}

if (skippedNames.length > 0) {
  print("⚠ Skipped " + skippedNames.length + " duplicate uniroom_name(s):");
  skippedNames.forEach(name => print("  - " + name));
}

if (filteredUniversities.length > 0) {
  const result = db.universities.insertMany(filteredUniversities);
  print("✓ Inserted " + result.insertedIds.length + " documents");
} else {
  print("✓ No new universities to insert");
}
SCRIPT

# Run MongoDB script
echo "Inserting $COUNT universities to MongoDB..."
mongosh "$MONGODB_URI" < "$MONGO_FILE"