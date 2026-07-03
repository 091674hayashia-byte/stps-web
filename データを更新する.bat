@echo off
echo MDBからデータを再読み込みします...
powershell -ExecutionPolicy Bypass -Command ^
"$connStr = 'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=''C:\仕事関係2\STPS NEW\STPS.mdb'';'; ^
function Export-Table($sql, $outFile) { ^
    $conn = New-Object System.Data.OleDb.OleDbConnection($connStr); ^
    $conn.Open(); ^
    $cmd = $conn.CreateCommand(); ^
    $cmd.CommandText = $sql; ^
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd); ^
    $ds = New-Object System.Data.DataSet; ^
    $adapter.Fill($ds) | Out-Null; ^
    $conn.Close(); ^
    $dt = $ds.Tables[0]; ^
    $result = @(); ^
    foreach ($row in $dt.Rows) { ^
        $obj = @{}; ^
        foreach ($col in $dt.Columns) { ^
            $val = $row[$col.ColumnName]; ^
            if ($val -is [System.DBNull]) { $obj[$col.ColumnName] = $null } ^
            elseif ($val -is [System.DateTime]) { $obj[$col.ColumnName] = $val.ToString('yyyy-MM-dd') } ^
            elseif ($val.GetType().IsValueType -and -not ($val -is [System.String])) { try { $obj[$col.ColumnName] = [int]$val } catch { $obj[$col.ColumnName] = \"$val\" } } ^
            else { $obj[$col.ColumnName] = \"$val\".Trim() } ^
        }; ^
        $result += $obj ^
    }; ^
    $result | ConvertTo-Json -Depth 3 -Compress | Set-Content $outFile -Encoding UTF8; ^
    Write-Host \"$([System.IO.Path]::GetFileName($outFile)): $($result.Count)件\" ^
}; ^
Export-Table 'SELECT * FROM T_材料 ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\exercises.json'; ^
Export-Table 'SELECT * FROM T_強度 ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\intensities.json'; ^
Export-Table 'SELECT * FROM T_種目 ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\categories.json'; ^
Export-Table 'SELECT * FROM T_距離 ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\distances.json'; ^
Export-Table 'SELECT * FROM T_練習パート ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\parts.json'; ^
Export-Table 'SELECT * FROM T_メニュー ORDER BY 日付' 'C:\仕事関係2\STPS_Web\data\menus.json'; ^
Export-Table 'SELECT * FROM T_セット ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\sets.json'; ^
Export-Table 'SELECT * FROM T_分類 ORDER BY ID' 'C:\仕事関係2\STPS_Web\data\bunrui.json'; ^
Write-Host '完了！'"
echo.
echo 完了しました。アプリのブラウザをリロード（F5）してください。
pause
