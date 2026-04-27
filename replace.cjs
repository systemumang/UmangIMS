const fs = require('fs');

function processFile(path, replacement) {
  let content = fs.readFileSync(path, 'utf8');
  if (content.includes('\u0000')) {
    content = fs.readFileSync(path, 'utf16le');
  }
  
  if (content.includes('createPurchaseRequest')) {
    content = content.replace(
      /import \{ createPurchaseRequest, fetchFirms, type Firm \} from '@\/src\/lib\/purchaseRequests';/,
      `import { fetchFirms, type Firm } from '@/src/lib/purchaseRequests';\nimport { ${replacement} } from '@/src/lib/stockMaster';`
    );
    content = content.replace(
      /createPurchaseRequest\(\{\s*firmId,\s*requestType,\s*projectId:\s*requestType === 'Project' \? projectId\.trim\(\) : null,\s*department,\s*requestedBy,\s*requiredDate,\s*items:\s*normalizedItems,?\s*\}\)\s*\.then\(\(created\) => onCreated\(created\.pr\.id\)\)/s,
      `${replacement}({ firmId: firms.find(f => f.id === firmId)?.name || firmId, department, person: requestedBy, date: requiredDate, items: normalizedItems }).then(created => onCreated(created.id))`
    );
  } else if (content.includes('createIssue({')) {
      // In case PowerShell already replaced createIssue but not others, just let it be.
  }
  
  fs.writeFileSync(path, content, 'utf8');
}

processFile('src/components/views/ItemIssueView.tsx', 'createIssue');
processFile('src/components/views/ReturnView.tsx', 'createReturn');
processFile('src/components/views/DamageView.tsx', 'createDamage');
console.log('Done');
